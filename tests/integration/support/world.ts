import {
  QuickPickleWorld,
  setWorldConstructor,
  type InfoConstructor,
  type QuickPickleWorldInterface,
} from "quickpickle"
import type { TestContext } from "vitest"
import { Effect } from "effect"
import assert from "node:assert"
import { execSync, execFile as execFileCb, spawn } from "node:child_process"
import { promisify } from "node:util"

const execFile = promisify(execFileCb)
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { constants as osConstants, networkInterfaces, tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { runCli, EXIT_OK } from "../../../src/cli/index.js"
import {
  makeCapturingCliIo,
  type ScriptedCommand,
  InMemRepo,
  applyEmittedScript,
} from "../../../src/testing/index.js"
import type { AppRouter } from "../../../src/ui/index.js"
import type { SteeringAnchor, SteeringView } from "../../../src/steering/index.js"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..")
// Exported so hooks.ts's PATH shim execs this SAME bundle, never a globally-installed gtd.
export const GTD_BIN = join(PROJECT_ROOT, "dist/gtd.bundle.mjs")

export type Tier = "live" | "inmem"

/**
 * The `done` mutation's own note-carrying request (package 04 Task 1's
 * nested `{ note: {...} }` shape) — every real `spawnGtdUi*AndHandOff`
 * helper below builds the exact same shape off its own `filePath`/`headSha`/
 * `content`/`mode`/`text`, at a fixed paragraph-0 anchor (the phone's own
 * "Save & Done" always attaches to the anchor the human was looking at,
 * which every one of these scenarios sets up as paragraph 0).
 */
const doneNoteRequest = (
  filePath: string,
  headSha: string,
  contentHash: string,
  mode: string | undefined,
  text: string,
) => ({
  note: {
    filePath,
    expectedHeadSha: headSha,
    expectedContentHash: contentHash,
    mode,
    anchor: { kind: "paragraph" as const, line: 0 },
    text,
  },
})

/**
 * Commands that print a `required`/`optional` script for a driver to run
 * instead of performing their git effect directly (`land`, `abandon`,
 * `restore`, bare `gtd --entry <state>`). Everything else is a read command
 * with nothing to drive.
 */
const WRITE_COMMAND_TOKENS: ReadonlySet<string> = new Set(["land", "abandon", "restore", "--entry"])

/**
 * `--json` (bare or `--json=<path>`) prints a structured document, not the
 * runnable script itself — never something `driveWriteCommand` should feed
 * to `sh` as-is.
 */
const requestsStructuredOutput = (args: readonly string[]): boolean =>
  args.some((a) => a === "--json" || a.startsWith("--json="))

/** `--entry` takes both spellings, `--entry <state>` and `--entry=<state>`. */
const isWriteCommand = (args: readonly string[]): boolean => {
  if (requestsStructuredOutput(args)) return false
  const first = args[0] ?? ""
  return WRITE_COMMAND_TOKENS.has(first) || first.startsWith("--entry=")
}

/** `gtd land` exits `EXIT_OK` on any successful landing; only a refusal or usage error has nothing to drive. */
const landExitDrivable = (exitCode: number): boolean => exitCode === EXIT_OK

/** The one line of a possibly multi-document stdout that parses as a JSON object (`gtd check --json`'s failing shape emits two). */
const firstJsonObject = (stdout: string): Record<string, unknown> | undefined => {
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue
    try {
      return JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
  }
  return undefined
}

const stringField = (json: Record<string, unknown>, key: string): string =>
  typeof json[key] === "string" ? json[key] : ""

/** `gtd validate`'s own "nothing to run" plain-text line — `program.ts`'s `runValidateCommand`. */
const NOTHING_TO_VALIDATE_RE = /^nothing to validate at "/

/** A real `sh` exit + combined output on the live tier, or the recognizer's verdict on the in-memory one. */
interface EmittedRun {
  readonly exitCode: number
  readonly output: string
}

const execFailure = (err: unknown): EmittedRun => {
  const e = err as { code?: unknown; stdout?: string; stderr?: string }
  return {
    exitCode: typeof e.code === "number" ? e.code : 1,
    output: (e.stdout ?? "") + (e.stderr ?? ""),
  }
}

/** Like `execFailure`, but keeps stdout/stderr separate for `GtdWorld.lastResult`. */
const execFailureResult = (err: unknown): { exitCode: number; stdout: string; stderr: string } => {
  const e = err as { code?: unknown; stdout?: string; stderr?: string }
  return {
    exitCode: typeof e.code === "number" ? e.code : 1,
    stdout: e.stdout ?? "",
    stderr: e.stderr ?? "",
  }
}

/**
 * A refusal on an unrecognized script block is THROWN rather than returned
 * as an exit code, so a builder added without teaching the recognizer fails
 * the suite loudly instead of masquerading as a legitimate script failure.
 */
const applyScriptToFake = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  script: string,
): EmittedRun => {
  const applied = applyEmittedScript(repo, commands, script)
  if (applied.ok) return { exitCode: 0, output: "" }
  const error = applied.error ?? ""
  if (error.startsWith("unrecognized script block:")) {
    throw new Error(
      `the in-memory tier could not apply an emitted script — ${error}\n` +
        `Teach src/testing/EmittedScriptRecognizer.ts about it.\nScript:\n${script}`,
    )
  }
  return { exitCode: 1, output: `${error}\n` }
}

/** Includes mtime, not just content, since a rewrite that lands the same bytes still bumps it. */
interface FileFingerprint {
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
}

/** A point-in-time fingerprint of the repo. `@live` only: the in-memory tier has no git dir to observe. */
export interface RepoSnapshot {
  readonly gitDirFiles: readonly FileFingerprint[]
  readonly gitStatus: string
  readonly worktreeFiles: readonly string[]
}

/** Sorted so two snapshots compare deterministically. */
const listFiles = (root: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort()

const fingerprintFiles = (root: string): FileFingerprint[] =>
  listFiles(root).map((path) => {
    const stat = statSync(join(root, path))
    return { path, size: stat.size, mtimeMs: stat.mtimeMs }
  })

/** The POSIX-style `$?` for a `(code, signal)` exit pair: 128 + the signal's number on a signal death, `code` otherwise. */
const signalExitStatus = (code: number | null, signal: NodeJS.Signals | null): number =>
  signal !== null ? 128 + (osConstants.signals[signal] ?? 0) : (code ?? 0)

/** `{ [key]: value }` when `value` is set, `{}` when it's `undefined` — `spawnEnv`'s own building block for each of its several optional overrides, so adding one more never adds another branch there. */
const optionalEnv = (key: string, value: string | undefined): NodeJS.ProcessEnv =>
  value !== undefined ? { [key]: value } : {}

/** How a driver reports `gtd validate`'s emitted script once it has run: `<file>: valid`, or the script's own output as findings. */
const validateVerdict = (
  file: string,
  run: EmittedRun,
): { exitCode: number; stdout: string; stderr: string } =>
  run.exitCode === 0
    ? { exitCode: 0, stdout: `${file}: valid\n`, stderr: "" }
    : {
        exitCode: run.exitCode,
        stdout: "",
        stderr: `gtd validate: ${file} is not valid\n${run.output}`,
      }

export class GtdWorld extends QuickPickleWorld {
  // Under `moduleResolution: nodenext`, a bare subclass of `QuickPickleWorld`
  // loses its base class's members from TS's view entirely (a dual CJS/ESM
  // `exports` map quirk) — re-declaring this field restores it.
  declare info: QuickPickleWorldInterface["info"]

  constructor(context: TestContext, info: InfoConstructor) {
    super(context, info)
  }

  repoDir!: string
  /** An extra ancestor directory the After hook must also remove, set when a scenario nests the repo under a purpose-built parent. */
  extraCleanupDir: string | undefined = undefined
  /** When set, file/git ops use this in-memory repo instead of `repoDir`. */
  repo: InMemRepo | undefined = undefined
  tier: Tier = "inmem"

  lastResult: { exitCode: number; stdout: string; stderr: string } = {
    exitCode: 0,
    stdout: "",
    stderr: "",
  }
  /**
   * What the last driven write command's `required`/`optional` scripts
   * printed — distinct from `lastResult.stdout` (gtd's own plain-text line).
   * LIVE tier only: the in-memory `applyEmittedScript` never runs outcome
   * blocks. Reset at the start of every `driveWriteCommand` call so a
   * scenario never reads a stale prior command's output.
   */
  lastScriptOutput: string = ""
  savedCommitCount: number | undefined = undefined
  /** Named JSON fields captured from a prior `--json` output — lets a scenario prove two turns' values for the same field are the same or different without knowing the exact value in advance. */
  recordedJsonFields: Record<string, string | undefined> = {}
  /** Named sets of top-level JSON keys captured from a prior `--json` stdout — for a drift guard proving a later document (e.g. `gtd install`'s briefing) still names every field a real command emits. */
  recordedJsonKeys: Record<string, readonly string[]> = {}
  /** Raw `lastResult.stdout` captured under a scenario-chosen label — for a poll-safety proof that two runs of the same read command answer byte-identically. */
  recordedStdout: Record<string, string | undefined> = {}
  /** A `snapshotRepo()` result saved for later comparison. */
  savedSnapshot: RepoSnapshot | undefined = undefined
  /**
   * The `(code, signal)` pair from the last `spawnGtdNextAndSignal` call,
   * plus the POSIX-style `status` a shell's `$?` would read off that death.
   * `code === null && signal` set distinguishes a re-raised signal from a
   * `process.exit(130)` that reuses the same number. `@live` only.
   */
  lastSignalExit:
    | { code: number | null; signal: NodeJS.Signals | null; status: number }
    | undefined = undefined
  /** Whether the spawned `gtd next` was still alive (neither exited nor already signalled) the instant before `spawnGtdNextAndSignal` sent its signal — proves the process was actually there to interrupt, not racing its own natural exit. `@live` only. */
  signalAliveAtSend: boolean | undefined = undefined
  /** Baseline byte count `runGtdNextRedirectedAndPiped`'s piped count is compared against, to prove a large artifact is never truncated. `@live` only. */
  directRedirectByteCount: number | undefined = undefined
  /** Byte count reaching a deliberately slow pipe consumer, set alongside `directRedirectByteCount`. `@live` only. */
  pipedByteCount: number | undefined = undefined
  /** Path to a stub agent script for `driver-doc` scenarios (@live only) — the `claude` shim translates the docs/driver.md driver's argv into this stub's `$GTD_LOOP_*` env. */
  stubAgentPath: string | undefined = undefined
  /** Explicit `$GTD_TESTCOMMAND` override for a real `checking`/`fix-precheck` script run (@live only). */
  gtdTestCommandOverride: string | undefined = undefined
  /** A scenario-scoped temp dir holding a `gtd` shim so a bare `gtd` invoked by name resolves to this build, not a globally-installed one. Live tier only. */
  pathShimDir: string | undefined = undefined
  /** State dir for the fake `tailscale` CLI `pathShimDir` also carries (`hooks.ts#FAKE_TAILSCALE_SCRIPT`) — one `<port>.mapping` file per published serve port. Live tier only. */
  tailscaleStateDir: string | undefined = undefined
  /** Sandboxes `src/ui/Serve.ts#serveDir`'s `~/.gtd/serve/<port>.json` ownership record for the serve-path spawn helpers only (`spawnBoundGtdUiServe`/`withServeHome`) — never the general `spawnEnv()`, so every OTHER live spawn keeps the real `$HOME` and its config-discovery walk. Live tier only. */
  serveHomeDir: string | undefined = undefined
  /** Package 01 Task 6's own discovered port: `spawnGtdUiServeAndHandOffDefaultPort` can't know ahead of time which candidate the walk lands on, so it's read back off the scan and stashed here for a later `Then` step to assert against. */
  lastServePort: number | undefined = undefined
  /** Package 01 Task 10's own `view` result — `spawnGtdUiAndReadView`'s real `readSteeringFile` query response, stashed for a later `Then` step to assert the rendered node shapes against. */
  lastSteeringView: SteeringView | undefined = undefined
  /** Package 01 Task 10's own stale-write proof: the typed refusal `spawnGtdUiAndSetValueWithStaleHash` reads off a real rejected `setValue` mutation, or `undefined` if the write unexpectedly succeeded. */
  lastWriteRefusal: { readonly reason: string; readonly moved?: string } | undefined = undefined
  /** Package 01 Task 10's own `ui.format` proof: the first write's own post-format `contentHash`, and whether a second write issued against it succeeded — `spawnGtdUiAndWriteTwiceReusingHash`'s result. */
  formatWriteResult: { readonly firstContentHash: string; readonly secondOk: boolean } | undefined =
    undefined
  /** A temp dir OUTSIDE the repo holding docs/driver.md's extracted driver script — proves the paste needs nothing inside the project. */
  driverDocDir: string | undefined = undefined
  /** Absolute path to the extracted driver script inside `driverDocDir`, chmod'd executable. */
  driverDocPath: string | undefined = undefined

  /** Env vars the in-memory tier's `EnvVars` layer exposes — never mutates the real `process.env`. */
  envVars: Record<string, string> = {}

  /** Extra env vars merged into every LIVE-tier subprocess's environment, overriding `process.env` — never the real `process.env` itself. `@live` only. */
  liveEnvOverrides: Record<string, string> = {}
  /** The relocated git dir a scenario moved `<repoDir>/.git` to, outside the worktree, so gtd can only find it via `$GIT_DIR`. `@live` only. */
  customGitDir: string | undefined = undefined
  /** The scratch directory a scenario points `$TMPDIR` at — checked empty afterward to prove nothing writes there. `@live` only. */
  customTmpDir: string | undefined = undefined

  /** Canned `bash` command behaviors the in-memory tier's fake shell (`applyEmittedScript`) runs an emitted script against, since real subprocess execution is unreachable against an in-memory worktree. */
  scriptedCommands: Map<string, ScriptedCommand> = new Map()

  /**
   * The e2e DRIVER — the test-suite counterpart of a real driver. gtd's write
   * commands print a script rather than performing their git effect
   * themselves, so the world has to be the thing that runs them: invoke the
   * command as the scenario asked (`lastResult` carries gtd's own wording and
   * exit code verbatim), then drive whatever it emitted. A read command emits
   * nothing and falls straight through; only a refusal or usage error skips
   * driving `gtd land`'s emitted script.
   */
  async runGtd(...args: string[]): Promise<void> {
    await this.invokeGtd(...args)
    if (!landExitDrivable(this.lastResult.exitCode)) return
    if (isWriteCommand(args)) await this.driveWriteCommand(args)
    else if (args[0] === "validate") await this.driveValidateCommand()
  }

  /**
   * Plain `gtd land`'s own preview, undriven — package 02's prose sentence
   * carries no script to run, so this is a read: `gtd land`'s own git-write
   * effect is exercised by `driveLandWrite`/`runGtd`, never by this one.
   */
  async runGtdLandPlain(): Promise<void> {
    await this.invokeGtd("land")
  }

  /**
   * `gtd land`'s own drive path — package 02 dropped plain `gtd land`'s
   * script output, so any bare `land` invocation (with or without
   * `--cost`/`--model`) is driven off a SECOND, `--json=script`-suffixed
   * call's own raw output instead of the first call's (now prose) stdout —
   * a `--json=<path>` selection on a string field writes the value straight
   * to stdout (`Select.ts`'s `toSelection`), no `eval`/unquoting needed.
   * `lastResult` keeps the first call's own wording/exit code — a scenario's
   * "it succeeds"/stdout assertion still describes the invocation it asked
   * for — and is overridden only when the driven script itself fails.
   */
  private async driveLandWrite(args: readonly string[]): Promise<void> {
    this.lastScriptOutput = ""
    const reported = this.lastResult
    await this.invokeGtd(...args, "--json=script")
    const script = this.lastResult.stdout
    this.lastResult = reported
    if (script.length === 0) return
    const run = await this.runEmittedScript(script)
    this.lastScriptOutput += run.output
    if (run.exitCode === 0) return
    this.lastResult = {
      exitCode: run.exitCode,
      stdout: reported.stdout,
      stderr: reported.stderr + run.output,
    }
  }

  private async invokeGtd(...args: string[]): Promise<void> {
    if (this.tier === "inmem") {
      await this.runGtdInMem(...args)
    } else {
      await this.runGtdLive(...args)
    }
  }

  /**
   * Runs the whole of `lastResult.stdout` as one script (required then
   * optional, swallowing the optional half's failure). gtd's own plain-text
   * line stays as `lastResult`; only a FAILING script overrides it, since a
   * scenario asserting "it succeeds" must not pass when the work never
   * landed. `land` is the one exception: package 02 dropped its plain
   * stdout's script output, so it's driven off `driveLandWrite` instead.
   */
  private async driveWriteCommand(args: readonly string[]): Promise<void> {
    if (args[0] === "land") return this.driveLandWrite(args)
    this.lastScriptOutput = ""
    const script = this.lastResult.stdout
    if (script.length === 0) return
    const run = await this.runEmittedScript(script)
    this.lastScriptOutput += run.output
    if (run.exitCode === 0) return
    this.lastResult = {
      exitCode: run.exitCode,
      stdout: this.lastResult.stdout,
      stderr: this.lastResult.stderr + run.output,
    }
  }

  /**
   * gtd prints the format-then-validate script as plain text — the verdict
   * lives in that script's exit code, not the command's. `validate` doesn't
   * name the file itself, so the file name for the verdict message is probed
   * off a `gtd next --json` call against the same rest instead.
   */
  private async driveValidateCommand(): Promise<void> {
    const script = this.lastResult.stdout
    if (NOTHING_TO_VALIDATE_RE.test(script)) return
    const run = await this.runEmittedScript(script)
    const file = await this.currentValidateFile()
    this.lastResult = validateVerdict(file, run)
  }

  /** Probes `gtd next --json`'s `file` field, restoring `lastResult` to gtd's own `validate` output afterwards. */
  private async currentValidateFile(): Promise<string> {
    const reported = this.lastResult
    await this.invokeGtd("next", "--json")
    const probe = this.lastResult
    this.lastResult = reported
    const parsed = firstJsonObject(probe.stdout)
    return parsed !== undefined ? stringField(parsed, "file") : ""
  }

  private async runEmittedScript(script: string): Promise<EmittedRun> {
    return this.repo !== undefined
      ? applyScriptToFake(this.repo, this.scriptedCommands, script)
      : this.runScriptWithSh(script)
  }

  /** Real `sh`, with the PATH shim in scope so a script's bare `gtd` resolves to this build. */
  private async runScriptWithSh(script: string): Promise<EmittedRun> {
    try {
      const { stdout, stderr } = await execFile("sh", ["-c", script], {
        cwd: this.repoDir,
        env: this.spawnEnv(),
        encoding: "utf-8",
        timeout: 30_000,
      })
      return { exitCode: 0, output: stdout + stderr }
    } catch (err: unknown) {
      return execFailure(err)
    }
  }

  /**
   * The environment every live-tier subprocess gets. Prepends the PATH shim
   * dir so a bare `gtd` invoked by name resolves to this build, not a stray
   * global install. `liveEnvOverrides` layers on last, highest precedence.
   */
  private spawnEnv(): NodeJS.ProcessEnv {
    const pathEnv = this.pathShimDir
      ? { PATH: `${this.pathShimDir}:${process.env["PATH"] ?? ""}` }
      : {}
    return {
      ...process.env,
      ...pathEnv,
      ...optionalEnv("GTD_TESTCOMMAND", this.gtdTestCommandOverride),
      ...optionalEnv("GTD_TEST_TAILSCALE_DIR", this.tailscaleStateDir),
      ...this.liveEnvOverrides,
      NODE_OPTIONS: undefined,
    }
  }

  // fallow-ignore-next-line complexity
  async runGtdLive(...args: string[]): Promise<void> {
    const verbose = process.env["GTD_E2E_VERBOSE"] === "1"
    try {
      const { stdout, stderr } = await execFile(process.execPath, [GTD_BIN, ...args], {
        cwd: this.repoDir,
        env: this.spawnEnv(),
        encoding: "utf-8",
        timeout: 30_000,
      })
      if (verbose) {
        process.stderr.write(stdout)
        process.stderr.write(stderr)
      }
      this.lastResult = { exitCode: 0, stdout, stderr }
    } catch (err: unknown) {
      const e = err as { code?: unknown; stdout?: string; stderr?: string }
      const exitCode = typeof e.code === "number" ? e.code : 1
      const stdout = e.stdout ?? ""
      const stderr = e.stderr ?? ""
      if (verbose) {
        process.stderr.write(stdout)
        process.stderr.write(stderr)
      }
      this.lastResult = { exitCode, stdout, stderr }
    }
  }

  /**
   * `gtd land --json=script` piped directly into `sh`, exactly as
   * `docs/driver.md`'s reference driver does: a `--json=<path>` VALUE
   * selection writes the selected field's raw text straight to stdout
   * (`Select.ts`'s `toSelection` on a string scalar is just `String(value)`,
   * newlines and all) — so the script is pipeable with no intermediate
   * parsing or `eval`.
   */
  async runGtdLandJsonScriptPiped(): Promise<void> {
    const pipeline = `${JSON.stringify(process.execPath)} ${JSON.stringify(GTD_BIN)} land --json=script | sh`
    try {
      const { stdout, stderr } = await execFile("sh", ["-c", pipeline], {
        cwd: this.repoDir,
        env: this.spawnEnv(),
        encoding: "utf-8",
        timeout: 30_000,
      })
      this.lastResult = { exitCode: 0, stdout, stderr }
    } catch (err: unknown) {
      this.lastResult = execFailureResult(err)
    }
  }

  /**
   * `@live` only — proves a large `gtd next` prompt survives its own exit
   * through a pipe under backpressure. Runs the same command two real
   * `bash -c` shell redirects: direct (`gtd next > file`, the truncation
   * baseline) and piped (`gtd next | { sleep 2; cat; } > file`, where the
   * sleep holds the reader off long enough to force `process.stdout.write`
   * to queue under backpressure). Byte counts are read back with `statSync`
   * since bash's redirect writes straight to disk, never through this
   * process.
   */
  async runGtdNextRedirectedAndPiped(): Promise<void> {
    const bin = `${JSON.stringify(process.execPath)} ${JSON.stringify(GTD_BIN)}`
    const directFile = join(mkdtempSync(join(tmpdir(), "gtd-pipe-direct-")), "out")
    const pipedFile = join(mkdtempSync(join(tmpdir(), "gtd-pipe-piped-")), "out")
    const runOpts = {
      cwd: this.repoDir,
      env: this.spawnEnv(),
      encoding: "utf-8" as const,
      timeout: 30_000,
    }

    await execFile("bash", ["-c", `${bin} next > ${JSON.stringify(directFile)}`], runOpts).catch(
      () => {},
    )
    this.directRedirectByteCount = statSync(directFile).size

    const pipeline = `${bin} next | { sleep 2; cat; } > ${JSON.stringify(pipedFile)}`
    try {
      await execFile("bash", ["-c", pipeline], runOpts)
      this.lastResult = { exitCode: 0, stdout: "", stderr: "" }
    } catch (err: unknown) {
      this.lastResult = execFailureResult(err)
    }
    this.pipedByteCount = statSync(pipedFile).size
  }

  /**
   * `@live` only — spawns `gtd next` directly against a prompt padded past
   * the OS pipe buffer, so its `stdout` write blocks with nothing draining
   * the pipe, guaranteeing the process is still alive when the signal
   * arrives. Delivers `signal` to the spawned process itself, not a shell
   * wrapper — a signal sent to a wrapper's pid never reaches a plain
   * (non-`exec`'d) child.
   *
   * `code === null && signal` set is what distinguishes a re-raised signal
   * from a `process.exit(130)` that reuses the same number, even though both
   * read back the same POSIX `status`.
   */
  async spawnGtdNextAndSignal(signal: NodeJS.Signals): Promise<void> {
    const child = spawn(process.execPath, [GTD_BIN, "next"], {
      cwd: this.repoDir,
      env: this.spawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    })
    // `close`, not `exit`: `exit` fires as soon as the OS process dies, which
    // can race ahead of the stdio streams still draining buffered data into
    // Node — waiting for `close` instead means the drains below (whatever
    // they turn out to catch) have actually run before this resolves.
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("close", (code, sig) => resolve({ code, signal: sig }))
      },
    )
    await new Promise<void>((resolve) => child.once("spawn", () => resolve()))
    await delay(300)
    // Nothing reads `stdout`/`stderr` before this point, keeping the
    // ordering honest — but that is not what makes the signal land right.
    // The 200000-byte pad earns its place by keeping `next` busy computing
    // long enough that the fixed `delay(300)` above reliably lands while
    // gtd is still alive, not by filling the OS pipe buffer: see the
    // package's Design amendment for why the child is never observably
    // blocked mid-write here.
    //
    // Sending the signal any LATER than this (e.g. waiting for `stdout` to
    // show buffered bytes) is provably too late to observe: `runCli`'s own
    // completion — issuing the `stdout.write` and setting `exitCode` — is one
    // synchronous step (`Cli.ts`'s `Effect.map`), so by the time a byte is
    // ever observable on this end, `NodeRuntime.runMain`'s fiber has already
    // exited on its own and detached its SIGINT/SIGTERM listener (see
    // `@effect/platform-node-shared`'s `runtime.js`) — a signal arriving
    // after that point is silently swallowed by `main.ts`'s leftover
    // `process.once` and the process just exits normally (status 0), not
    // via the signal this scenario is testing. The signal has to land WHILE
    // gtd is still computing the prompt, before it ever reaches the write.
    this.signalAliveAtSend = child.exitCode === null && child.signalCode === null
    child.kill(signal)
    // `.resume()` alone (no `data` listener) is the standard drain-and-discard
    // idiom: it pulls the stream into flowing mode so a still-pending write
    // can finish, without this harness caring what the bytes are — see the
    // package's Design amendment for why a byte count here proves nothing.
    child.stdout?.resume()
    child.stderr?.resume()
    const { code, signal: died } = await exited
    this.lastSignalExit = { code, signal: died, status: signalExitStatus(code, died) }
  }

  /**
   * Package 05's own process-lifecycle contract, exercised as a REAL OS
   * process — something no `@inmem` scenario can reach at all: `gtd ui`
   * blocks forever in-process on success (`Effect.never`), so the `@inmem`
   * tier's own scenarios (`ui.feature`) only ever cover its fast, purely
   * deterministic REFUSAL paths, never an actual bind. Here, `--host
   * 127.0.0.1 --self-signed --port 0` sidesteps both things that make a
   * successful bind non-deterministic in CI (no tailnet needed, no fixed
   * port to collide on) — genuinely binds, prints its `https://` URL once
   * ready (polled for, since certificate generation's own subprocess cost
   * makes a fixed delay flaky the same way `spawnGtdNextAndSignal`'s 300ms
   * never has to account for a subprocess of its own), then dies exactly
   * like `spawnGtdNextAndSignal` — same signal, same re-raise contract,
   * same `lastSignalExit`/"the reported exit status is {int}" step this
   * reuses verbatim.
   */
  async spawnGtdUiAndSignal(signal: NodeJS.Signals): Promise<void> {
    const { child, exited } = await this.spawnBoundGtdUi()
    child.kill(signal)
    const { code, signal: died } = await exited
    this.lastSignalExit = { code, signal: died, status: signalExitStatus(code, died) }
  }

  /** Restores `NODE_TLS_REJECT_UNAUTHORIZED` to its own pre-spawn value — every real `done`/`setValue` mutation below toggles it insecure for exactly one request, then puts it back in a `finally`, regardless of whether the request itself succeeded. */
  private restoreTlsReject(previousTlsReject: string | undefined): void {
    if (previousTlsReject === undefined) delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    else process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = previousTlsReject
  }

  /** Waits for a spawned `gtd ui` to exit ON ITS OWN and records the same `(code, signal, status)` triple `spawnGtdUiAndSignal` records for a SIGNALLED exit — the shared tail every `spawnGtdUi*AndHandOff` helper below ends on. */
  private async recordSpawnedExit(
    exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
  ): Promise<void> {
    const { code, signal } = await exited
    this.lastSignalExit = { code, signal, status: signalExitStatus(code, signal) }
  }

  /**
   * Spawns a real `gtd ui` over the same `--host 127.0.0.1 --self-signed
   * --port 0` shape `spawnGtdUiAndSignal` uses, polls for its printed
   * `https://` URL, and returns once bound — factored out so a scenario that
   * needs to talk tRPC to the real listener (`spawnGtdUiAndHandOff`) doesn't
   * duplicate the spawn/poll dance.
   */
  private async spawnBoundGtdUi(): Promise<{
    readonly child: ReturnType<typeof spawn>
    readonly boundUrl: string
    readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  }> {
    const child = spawn(
      process.execPath,
      [GTD_BIN, "ui", "--host", "127.0.0.1", "--self-signed", "--port", "0"],
      { cwd: this.repoDir, env: this.spawnEnv(), stdio: ["ignore", "pipe", "pipe"] },
    )
    let stdout = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("exit", (code, sig) => resolve({ code, signal: sig }))
      },
    )
    await new Promise<void>((resolve) => child.once("spawn", () => resolve()))
    for (let i = 0; i < 100 && !stdout.includes("https://"); i += 1) {
      await delay(50)
    }
    assert.ok(stdout.includes("https://"), `gtd ui never printed its bound URL: ${stdout}`)
    const boundUrl = stdout.split("\n")[0]!.trim()
    return { child, boundUrl, exited }
  }

  /**
   * Package 01's own serve-path counterpart of `spawnBoundGtdUi`: no
   * `--host`/`--self-signed`, so `runUiCommand` takes the SERVE branch —
   * against the fake `tailscale` CLI `hooks.ts#FAKE_TAILSCALE_SCRIPT`
   * installs on `$PATH` (neither a real tailnet nor even the `tailscale`
   * binary is guaranteed on a CI runner). Factored out so both
   * `spawnGtdUiServeAndHandOff` (needs to talk tRPC to the real listener)
   * and `spawnGtdUiServeAndSignal` (Task 4's own SIGINT/SIGTERM teardown
   * coverage) share the one spawn/poll dance.
   */
  /**
   * Runs `fn` with the TEST PROCESS's own `$HOME` temporarily pointed at
   * `serveHomeDir` — the sandbox the spawned `gtd ui` child's own env already
   * uses (`spawnBoundGtdUiServe`) — so a direct in-process
   * `readServeRecord`/`deleteServeRecord` call (node:os `homedir()` reads
   * `$HOME`) agrees with the child on where `~/.gtd/serve/<port>.json`
   * lives, rather than reading the real developer's home directory. Scoped
   * to the one call it wraps and always restored, never a standing mutation
   * of this process's own env.
   */
  async withServeHome<T>(fn: () => T): Promise<T> {
    const previous = process.env["HOME"]
    process.env["HOME"] = this.serveHomeDir
    try {
      return fn()
    } finally {
      if (previous === undefined) delete process.env["HOME"]
      else process.env["HOME"] = previous
    }
  }

  private async spawnBoundGtdUiServe(servePort: number): Promise<{
    readonly child: ReturnType<typeof spawn>
    readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
    /** Everything printed so far, once polling below observes the bound URL — the publish-failure fallback's own reason line prints just above it, so a caller that armed `fail-publish` can assert on this without a second poll. */
    readonly stdout: () => string
  }> {
    // `$HOME` sandboxed to `serveHomeDir` — the spawned `gtd ui`'s own
    // `attemptServe`/`teardownServe` write/read `~/.gtd/serve/<port>.json`
    // (`src/ui/Serve.ts#serveDir`, via node:os `homedir()`), which is NOT
    // otherwise sandboxed the way the fake tailscale CLI's own state is
    // (`GTD_TEST_TAILSCALE_DIR`). Scoped to THIS spawn only, not
    // `spawnEnv()`'s general env, per `withServeHome`'s own doc comment.
    assert.ok(this.serveHomeDir !== undefined, "no serveHomeDir on this world (not @live?)")
    const child = spawn(process.execPath, [GTD_BIN, "ui", "--port", String(servePort)], {
      cwd: this.repoDir,
      env: { ...this.spawnEnv(), HOME: this.serveHomeDir },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("exit", (code, sig) => resolve({ code, signal: sig }))
      },
    )
    await new Promise<void>((resolve) => child.once("spawn", () => resolve()))
    for (let i = 0; i < 100 && !stdout.includes("https://"); i += 1) {
      await delay(50)
    }
    assert.ok(
      stdout.includes("https://"),
      `gtd ui never printed its serve URL: stdout=${stdout} stderr=${stderr}`,
    )
    return { child, exited, stdout: () => stdout }
  }

  /**
   * Task 4's own SIGINT/SIGTERM teardown coverage: a real `gtd ui` spawned
   * over the SERVE path (unlike `spawnGtdUiAndSignal`'s `--host 127.0.0.1
   * --self-signed`, which skips serve entirely per Task 3 step 1 and so
   * could only assert the mapping/record are absent VACUOUSLY), killed with
   * `signal`, same re-raise contract as `spawnGtdUiAndSignal`. Exercises the
   * spec's own flagged claim — `runMain` interrupts the fiber and `ensuring`
   * finalizers run on a REAL signal, not just on `Fiber.interrupt` in a unit
   * test.
   */
  async spawnGtdUiServeAndSignal(servePort: number, signal: NodeJS.Signals): Promise<void> {
    const { child, exited } = await this.spawnBoundGtdUiServe(servePort)
    child.kill(signal)
    const { code, signal: died } = await exited
    this.lastSignalExit = { code, signal: died, status: signalExitStatus(code, died) }
  }

  /**
   * Package 01's own serve-path counterpart of `spawnGtdUiAndHandOff`. The
   * printed URL names the fake tailnet hostname, which resolves nowhere
   * real, so the tRPC round trip dials the loopback TARGET port directly
   * instead — read out of the real ownership record `attemptServe` writes to
   * `~/.gtd/serve/<servePort>.json` (`src/ui/Serve.ts#writeServeRecord`),
   * over PLAIN http (no TLS: the loopback listener never terminates TLS,
   * `tailscaled` would). Returns once the process has exited on its own, so
   * the caller can assert the mapping/record are both gone (Task 4's own
   * teardown guarantee).
   */
  async spawnGtdUiServeAndHandOff(
    servePort: number,
    filePath: string,
    mode: string,
    text: string,
  ): Promise<void> {
    const { exited } = await this.spawnBoundGtdUiServe(servePort)

    const { readServeRecord } = await import("../../../src/ui/index.js")
    const record = await this.withServeHome(() => readServeRecord(servePort))
    assert.ok(
      record !== undefined,
      `no ownership record found at $HOME/.gtd/serve/${servePort}.json (sandboxed $HOME: ${this.serveHomeDir})`,
    )

    const [{ contentHashOf }, { createTRPCClient, httpBatchLink }] = await Promise.all([
      import("../../../src/ui/index.js"),
      import("@trpc/client"),
    ])
    const headSha = execSync("git rev-parse HEAD", { cwd: this.repoDir, encoding: "utf8" }).trim()
    const content = readFileSync(join(this.repoDir, filePath), "utf8")
    const client = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `http://127.0.0.1:${record!.targetPort}/trpc` })],
    })
    await client.done.mutate(doneNoteRequest(filePath, headSha, contentHashOf(content), mode, text))

    const { code, signal } = await exited
    this.lastSignalExit = { code, signal, status: signalExitStatus(code, signal) }
  }

  /**
   * Arms `hooks.ts`'s fake `tailscale` CLI to fail its NEXT `serve --bg` —
   * `FAKE_TAILSCALE_SCRIPT`'s own `fail-publish` marker, otherwise unused —
   * the one seam Task 3's "publish fails, falls back to a reachable direct
   * bind, exit 0 on handoff" bullet needs a real spawned process to
   * exercise. A `Given` step (composable, generic) rather than folded into
   * the spawn itself.
   */
  armFailPublish(): void {
    assert.ok(
      this.tailscaleStateDir !== undefined,
      "no fake tailscale state dir on this world (not @live?)",
    )
    writeFileSync(join(this.tailscaleStateDir, "fail-publish"), "")
  }

  /**
   * Package 01 Task 6's own seed for the candidate-walk scenario: writes a
   * mapping straight into the fake `tailscale` CLI's own state dir with NO
   * matching ownership record under `serveHomeDir` — exactly what a foreign
   * `gtd ui` (a different worktree/process) publishing on `port` first looks
   * like to THIS instance's own orphan check (`Server.ts#clearOrphanForPublish`),
   * which reads the mapping as occupied and the missing record as "not ours".
   */
  seedForeignServeMapping(port: number): void {
    assert.ok(
      this.tailscaleStateDir !== undefined,
      "no fake tailscale state dir on this world (not @live?)",
    )
    writeFileSync(join(this.tailscaleStateDir, `${port}.mapping`), "http://127.0.0.1:9999")
  }

  /**
   * Package 01 Task 6's own default-port counterpart of
   * `spawnBoundGtdUiServe`: spawns `gtd ui` with NO `--port` at all, so
   * `resolveListener`'s own candidate walk (8443 → 10000 → 443) picks
   * whichever one this run actually lands on — unlike every other serve
   * scenario here, the caller can't know that port ahead of time, so it's
   * discovered by scanning the sandboxed `~/.gtd/serve/` directory
   * (`serveHomeDir`) for the one ownership record this run wrote.
   */
  private async spawnBoundGtdUiServeDefaultPort(): Promise<{
    readonly child: ReturnType<typeof spawn>
    readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
    readonly stdout: () => string
    readonly servePort: number
  }> {
    assert.ok(this.serveHomeDir !== undefined, "no serveHomeDir on this world (not @live?)")
    const child = spawn(process.execPath, [GTD_BIN, "ui"], {
      cwd: this.repoDir,
      env: { ...this.spawnEnv(), HOME: this.serveHomeDir },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("exit", (code, sig) => resolve({ code, signal: sig }))
      },
    )
    await new Promise<void>((resolve) => child.once("spawn", () => resolve()))
    for (let i = 0; i < 100 && !stdout.includes("https://"); i += 1) {
      await delay(50)
    }
    assert.ok(
      stdout.includes("https://"),
      `gtd ui never printed its serve URL: stdout=${stdout} stderr=${stderr}`,
    )

    const serveDir = join(this.serveHomeDir!, ".gtd", "serve")
    const recordFiles = existsSync(serveDir)
      ? readdirSync(serveDir).filter((f) => f.endsWith(".json"))
      : []
    assert.strictEqual(
      recordFiles.length,
      1,
      `expected exactly one ownership record under ${serveDir}, found: ${recordFiles.join(", ")}`,
    )
    const servePort = Number(recordFiles[0]!.replace(/\.json$/, ""))

    return { child, exited, stdout: () => stdout, servePort }
  }

  /**
   * Package 01 Task 6's end-to-end proof of the default candidate walk: no
   * `--port` given at all, a foreign mapping seeded on 8443 (`Given the
   * scenario's own `seedForeignServeMapping`), so the walk must land on
   * 10000 — asserted by the caller reading `servePort` back off the
   * returned promise. Otherwise mirrors `spawnGtdUiServeAndHandOff`.
   */
  async spawnGtdUiServeAndHandOffDefaultPort(
    filePath: string,
    mode: string,
    text: string,
  ): Promise<number> {
    const { exited, servePort } = await this.spawnBoundGtdUiServeDefaultPort()

    const { readServeRecord } = await import("../../../src/ui/index.js")
    const record = await this.withServeHome(() => readServeRecord(servePort))
    assert.ok(
      record !== undefined,
      `no ownership record found at $HOME/.gtd/serve/${servePort}.json (sandboxed $HOME: ${this.serveHomeDir})`,
    )

    const [{ contentHashOf }, { createTRPCClient, httpBatchLink }] = await Promise.all([
      import("../../../src/ui/index.js"),
      import("@trpc/client"),
    ])
    const headSha = execSync("git rev-parse HEAD", { cwd: this.repoDir, encoding: "utf8" }).trim()
    const content = readFileSync(join(this.repoDir, filePath), "utf8")
    const client = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `http://127.0.0.1:${record!.targetPort}/trpc` })],
    })
    await client.done.mutate(doneNoteRequest(filePath, headSha, contentHashOf(content), mode, text))

    const { code, signal } = await exited
    this.lastSignalExit = { code, signal, status: signalExitStatus(code, signal) }
    this.lastServePort = servePort
    return servePort
  }

  /**
   * Task 3's publish-failure twin of `spawnGtdUiServeAndHandOff`: still no
   * `--host`/`--self-signed` (serve is still ATTEMPTED), but the fake
   * `tailscale serve --bg` fails (`armFailPublish`, called by the scenario's
   * own `Given` step first) — so `runUiCommand` falls back to today's direct
   * bind. That fallback's own host resolution has no `--host`/`ui.host`
   * either (giving one would skip the serve ATTEMPT entirely, defeating the
   * point), so it resolves the SAME real Tailscale CGNAT interface
   * `pickBindHostFromSystem` would — read here via the identical production
   * seam, not re-implemented, to know which address to actually dial (the
   * printed URL names the fake tailnet hostname, which resolves nowhere
   * real, exactly like the serve-success path). `ui.cert`/`ui.key` must be
   * configured (the scenario's own `Given` step provides a real cert/key
   * pair) — the fake tailscale CLI has no `cert` subcommand, so the
   * tailscale-cert branch `resolveCertPair` would otherwise take fails
   * outright rather than falling back.
   */
  async spawnGtdUiServePublishFailAndHandOff(
    servePort: number,
    filePath: string,
    mode: string,
    text: string,
  ): Promise<void> {
    const { exited, stdout } = await this.spawnBoundGtdUiServe(servePort)
    assert.ok(
      stdout().includes("not using tailscale serve"),
      `expected the fallback reason line before the bound URL, got:\n${stdout()}`,
    )

    // `pickBindHost` (the PURE scan), never `pickBindHostFromSystem` —
    // `ui.steps.ts`'s own `vi.mock("../../../../src/ui/BindSystem.js", ...)`
    // is a SUITE-WIDE mock (`setup-files.ts`'s own comment: it must load
    // first, before anything else's real import caches the module) that
    // always returns `undefined`, so calling the wrapper here would read
    // that mock, not this machine's real interfaces.
    const { pickBindHost } = await import("../../../src/ui/index.js")
    const bindHost = pickBindHost(networkInterfaces())
    assert.ok(
      bindHost !== undefined,
      "no 100.64.0.0/10 interface found on this machine — the direct-bind fallback this scenario exercises needs one (CI supplies a loopback alias; see .github/workflows/test.yml)",
    )

    const previousTlsReject = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    try {
      const [{ contentHashOf }, { createTRPCClient, httpBatchLink }] = await Promise.all([
        import("../../../src/ui/index.js"),
        import("@trpc/client"),
      ])
      const headSha = execSync("git rev-parse HEAD", { cwd: this.repoDir, encoding: "utf8" }).trim()
      const content = readFileSync(join(this.repoDir, filePath), "utf8")
      // Dials the REAL bind address/port directly — same reason
      // `spawnGtdUiServeAndHandOff` dials the loopback target directly
      // instead of the printed (fake-hostname) URL: this proves the
      // fallback bind is actually REACHABLE, not just that a listener object
      // exists somewhere.
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `https://${bindHost}:${servePort}/trpc` })],
      })
      await client.done.mutate(
        doneNoteRequest(filePath, headSha, contentHashOf(content), mode, text),
      )
    } finally {
      this.restoreTlsReject(previousTlsReject)
    }

    await this.recordSpawnedExit(exited)
  }

  /**
   * Requirement A end to end: a REAL `gtd ui` subprocess, a REAL HTTPS tRPC
   * `done` call against it, then the process observed exiting ON ITS OWN
   * (never signalled) — proving `handOff` actually terminates the server
   * once the response has flushed, with the note durably on disk first.
   * `filePath`'s content and the fresh `HEAD` sha are read directly (the
   * same tokens the phone client would have rendered) so the compare-and-
   * swap succeeds for real, not against a stale/guessed token.
   */
  async spawnGtdUiAndHandOff(
    filePath: string,
    mode: string | undefined,
    text: string,
  ): Promise<void> {
    const { boundUrl, exited } = await this.spawnBoundGtdUi()

    const previousTlsReject = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    try {
      const [{ contentHashOf }, { createTRPCClient, httpBatchLink }] = await Promise.all([
        import("../../../src/ui/index.js"),
        import("@trpc/client"),
      ])
      // `git rev-parse HEAD` directly, not `liveHeadSha` — `createTestProject`
      // is a PLAIN `git init` (no `--separate-git-dir`), and `liveHeadSha`'s
      // own relative-`.git`-path fallback resolves against the CALLING
      // process's cwd (this test file's), never `this.repoDir`, on a plain
      // repo shaped that way.
      const headSha = execSync("git rev-parse HEAD", { cwd: this.repoDir, encoding: "utf8" }).trim()
      const content = readFileSync(join(this.repoDir, filePath), "utf8")
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      await client.done.mutate(
        doneNoteRequest(filePath, headSha, contentHashOf(content), mode, text),
      )
    } finally {
      this.restoreTlsReject(previousTlsReject)
    }

    await this.recordSpawnedExit(exited)
  }

  /**
   * Package 04's own real acceptance of the Q&A deck's Done control: a REAL
   * `gtd ui` subprocess, a REAL `done` mutation carrying NO `note` at all —
   * the exact request the phone's own "Done" tap sends when there's nothing
   * to leave behind — then the process observed exiting ON ITS OWN, the
   * same way `spawnGtdUiAndHandOff`'s own note-carrying `done` call does.
   * No `filePath`/token/content is read here at all: with no note, `done`
   * has nothing to compare-and-swap.
   */
  async spawnGtdUiAndHandOffNoNote(): Promise<void> {
    const { boundUrl, exited } = await this.spawnBoundGtdUi()

    const previousTlsReject = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    try {
      const { createTRPCClient, httpBatchLink } = await import("@trpc/client")
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      await client.done.mutate({})
    } finally {
      this.restoreTlsReject(previousTlsReject)
    }

    await this.recordSpawnedExit(exited)
  }

  /**
   * Package 03's own on-disk round trip: a REAL `gtd ui` subprocess, a REAL
   * `setValue` tRPC mutation against it, splicing through
   * `SteeringFormat.apply` server-side (never `annotate`/`done` — this is
   * the checkbox write-through, not a note or a handoff). Unlike
   * `spawnGtdUiAndHandOff`/`spawnGtdUiAndClose`, `setValue` never ends the
   * turn, so the process does NOT exit on its own — this kills it (SIGTERM,
   * the same re-raise contract `spawnGtdUiAndSignal` uses) once the mutation
   * has resolved, so the scenario itself is what tears the spawned process
   * down, not a server-side handoff.
   */
  async spawnGtdUiAndSetValue(
    filePath: string,
    mode: string | undefined,
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<void> {
    const { child, boundUrl, exited } = await this.spawnBoundGtdUi()

    const previousTlsReject = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    try {
      const [{ contentHashOf }, { createTRPCClient, httpBatchLink }] = await Promise.all([
        import("../../../src/ui/index.js"),
        import("@trpc/client"),
      ])
      // `git rev-parse HEAD` directly — see `spawnGtdUiAndHandOff`'s identical
      // comment for why, not `liveHeadSha`.
      const headSha = execSync("git rev-parse HEAD", { cwd: this.repoDir, encoding: "utf8" }).trim()
      const content = readFileSync(join(this.repoDir, filePath), "utf8")
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      await client.setValue.mutate({
        filePath,
        expectedHeadSha: headSha,
        expectedContentHash: contentHashOf(content),
        mode,
        anchor,
        ...opts,
      })
    } finally {
      if (previousTlsReject === undefined) delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
      else process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = previousTlsReject
    }

    child.kill("SIGTERM")
    await exited
  }

  /**
   * Package 02's own idle round trip: a REAL `gtd ui` subprocess bound on an
   * IDLE worktree, a REAL `setValue` write that creates `filePath` from
   * scratch (there is nothing on disk yet — `content` reads as `""`, so this
   * splices through `freeform.ts#freeFormApply`'s own append fallback, never
   * `annotate`, which has no existing block to attach a footnote to), then a
   * REAL `done` mutation carrying NO note — the same two-call shape a phone
   * screen drives: the human's edit lands first, "hand off" is a separate
   * tap. `done` schedules the exit, so this ends on `recordSpawnedExit` like
   * `spawnGtdUiAndHandOff`, never a SIGTERM.
   */
  async spawnGtdUiAndSketchThenHandOff(filePath: string, text: string): Promise<void> {
    const { boundUrl, exited } = await this.spawnBoundGtdUi()

    const previousTlsReject = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    try {
      const [{ contentHashOf }, { createTRPCClient, httpBatchLink }] = await Promise.all([
        import("../../../src/ui/index.js"),
        import("@trpc/client"),
      ])
      const headSha = execSync("git rev-parse HEAD", { cwd: this.repoDir, encoding: "utf8" }).trim()
      const absPath = join(this.repoDir, filePath)
      const content = existsSync(absPath) ? readFileSync(absPath, "utf8") : ""
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      await client.setValue.mutate({
        filePath,
        expectedHeadSha: headSha,
        expectedContentHash: contentHashOf(content),
        mode: undefined,
        anchor: { kind: "paragraph", line: 0 },
        text,
      })
      await client.done.mutate({})
    } finally {
      this.restoreTlsReject(previousTlsReject)
    }

    await this.recordSpawnedExit(exited)
  }

  /**
   * Package 01 Task 10's own render-structure proof: a REAL `gtd ui`
   * subprocess, a REAL `readSteeringFile` tRPC query against it — the same
   * round trip a phone client's own first load drives — stashing the
   * returned `SteeringView` on `lastSteeringView` for a `Then` step to assert
   * node shapes against. `setValue`'s own teardown pattern: `readSteeringFile`
   * never ends the turn, so this kills the process (SIGTERM) once the query
   * has resolved.
   */
  async spawnGtdUiAndReadView(filePath: string, mode: string | undefined): Promise<void> {
    const { child, boundUrl, exited } = await this.spawnBoundGtdUi()

    const previousTlsReject = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    try {
      const { createTRPCClient, httpBatchLink } = await import("@trpc/client")
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      const result = await client.readSteeringFile.query({ filePath, mode })
      assert.ok(result.ok, `expected readSteeringFile to succeed, got: ${JSON.stringify(result)}`)
      this.lastSteeringView = result.view
    } finally {
      this.restoreTlsReject(previousTlsReject)
    }

    child.kill("SIGTERM")
    await exited
  }

  /**
   * Package 01 Task 10's own stale-token proof: a REAL `gtd ui` subprocess, a
   * REAL `setValue` mutation carrying a deliberately WRONG
   * `expectedContentHash` (the file's real HEAD sha, so only the content-hash
   * half of the compare-and-swap token is stale) — asserts the mutation
   * rejects as a real `TRPCClientError` (`Server.test.ts`'s own
   * `refusalDataFrom` pattern) and stashes its typed `writeRefusal` on
   * `lastWriteRefusal`, rather than letting an unexpected success pass
   * silently. `setValue`'s own teardown pattern: kills the process afterward.
   */
  async spawnGtdUiAndSetValueWithStaleHash(
    filePath: string,
    mode: string | undefined,
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<void> {
    const { child, boundUrl, exited } = await this.spawnBoundGtdUi()

    const previousTlsReject = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    try {
      const { createTRPCClient, httpBatchLink, TRPCClientError } = await import("@trpc/client")
      const headSha = execSync("git rev-parse HEAD", { cwd: this.repoDir, encoding: "utf8" }).trim()
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      try {
        await client.setValue.mutate({
          filePath,
          expectedHeadSha: headSha,
          // Deliberately wrong — the real content on disk never hashes to
          // this fixed 64-hex-digit string, so `verifyForWrite` refuses
          // `stale-token`/`moved: "content-hash"` regardless of what's
          // actually on disk.
          expectedContentHash: "0".repeat(64),
          mode,
          anchor,
          ...opts,
        })
        this.lastWriteRefusal = undefined
      } catch (error) {
        assert.ok(
          error instanceof TRPCClientError,
          `expected a real TRPCClientError, got: ${String(error)}`,
        )
        const data = (error as InstanceType<typeof TRPCClientError>).data as
          | { writeRefusal?: { reason: string; moved?: string } }
          | undefined
        assert.ok(data?.writeRefusal, `expected a writeRefusal on the rejected mutation's data`)
        this.lastWriteRefusal = data!.writeRefusal
      }
    } finally {
      this.restoreTlsReject(previousTlsReject)
    }

    child.kill("SIGTERM")
    await exited
  }

  /**
   * Package 01's own EISDIR proof: a REAL `gtd ui` subprocess, a REAL
   * `setValue` mutation against a `filePath` that resolves to a DIRECTORY on
   * disk — `liveReadFile` sees a real `EISDIR`, deterministic on every
   * machine (unlike `chmod 000`, a no-op when the suite runs as root).
   * Deliberately never reads `filePath` through this process's own `fs` first
   * (that would throw here, not inside the server) — the request carries a
   * fixed, always-wrong `expectedContentHash` instead, which never matters:
   * `verifyForWrite` refuses `file-vanished` on the unreadable read, before
   * the compare-and-swap ever inspects it. Mirrors
   * `spawnGtdUiAndSetValueWithStaleHash`'s own refusal-capture shape.
   */
  async spawnGtdUiAndSetValueAgainstUnreadableFile(
    filePath: string,
    mode: string | undefined,
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<void> {
    const { child, boundUrl, exited } = await this.spawnBoundGtdUi()

    const previousTlsReject = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    try {
      const { createTRPCClient, httpBatchLink, TRPCClientError } = await import("@trpc/client")
      const headSha = execSync("git rev-parse HEAD", { cwd: this.repoDir, encoding: "utf8" }).trim()
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      try {
        await client.setValue.mutate({
          filePath,
          expectedHeadSha: headSha,
          expectedContentHash: "0".repeat(64),
          mode,
          anchor,
          ...opts,
        })
        this.lastWriteRefusal = undefined
      } catch (error) {
        assert.ok(
          error instanceof TRPCClientError,
          `expected a real TRPCClientError, got: ${String(error)}`,
        )
        const data = (error as InstanceType<typeof TRPCClientError>).data as
          | { writeRefusal?: { reason: string; moved?: string } }
          | undefined
        assert.ok(data?.writeRefusal, `expected a writeRefusal on the rejected mutation's data`)
        this.lastWriteRefusal = data!.writeRefusal
      }
    } finally {
      this.restoreTlsReject(previousTlsReject)
    }

    child.kill("SIGTERM")
    await exited
  }

  /**
   * Package 01 Task 10's own `ui.format` round trip: a REAL `gtd ui`
   * subprocess, two REAL `setValue` mutations against the SAME anchor — the
   * first against the file's real on-disk token, the second reusing that
   * first mutation's own RETURNED `contentHash` (never a fresh read), which
   * only succeeds if the configured `ui.format` command's rewrite is exactly
   * what the returned hash already reflects (Task 6's whole point: a
   * client's own next edit is never spuriously refused `stale-token`/
   * `moved: "content-hash"` against a hash formatting just moved out from
   * under it). Stashes both the first hash and the second write's own
   * success on `formatWriteResult`.
   */
  async spawnGtdUiAndWriteTwiceReusingHash(
    filePath: string,
    mode: string | undefined,
    anchor: SteeringAnchor,
    firstText: string,
    secondText: string,
  ): Promise<void> {
    const { child, boundUrl, exited } = await this.spawnBoundGtdUi()

    const previousTlsReject = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    try {
      const [{ contentHashOf }, { createTRPCClient, httpBatchLink }] = await Promise.all([
        import("../../../src/ui/index.js"),
        import("@trpc/client"),
      ])
      const headSha = execSync("git rev-parse HEAD", { cwd: this.repoDir, encoding: "utf8" }).trim()
      const content = readFileSync(join(this.repoDir, filePath), "utf8")
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      const first = await client.setValue.mutate({
        filePath,
        expectedHeadSha: headSha,
        expectedContentHash: contentHashOf(content),
        mode,
        anchor,
        text: firstText,
      })
      let secondOk = true
      try {
        await client.setValue.mutate({
          filePath,
          expectedHeadSha: headSha,
          expectedContentHash: first.contentHash,
          mode,
          anchor,
          text: secondText,
        })
      } catch {
        secondOk = false
      }
      this.formatWriteResult = { firstContentHash: first.contentHash, secondOk }
    } finally {
      this.restoreTlsReject(previousTlsReject)
    }

    child.kill("SIGTERM")
    await exited
  }

  /**
   * Requirement B's real-process acceptance (package 03 Task 9): a REAL `gtd
   * ui` subprocess, a plain GET against its served origin — a page reload,
   * the exact request a pull-to-refresh reissues, no `pagehide` beacon exists
   * any more to mistake it for a close (Task 8) — THEN the same real `done`
   * handoff `spawnGtdUiAndHandOff` drives. Proves the server is still alive
   * through the reload and exits 0 through `done`, never through a beacon.
   */
  async spawnGtdUiReloadThenHandOff(filePath: string, mode: string, text: string): Promise<void> {
    const { boundUrl, exited } = await this.spawnBoundGtdUi()

    const previousTlsReject = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    try {
      const reload = await fetch(boundUrl)
      assert.strictEqual(reload.status, 200, "the reload must still be served, not a dead port")

      const [{ contentHashOf }, { createTRPCClient, httpBatchLink }] = await Promise.all([
        import("../../../src/ui/index.js"),
        import("@trpc/client"),
      ])
      // `git rev-parse HEAD` directly — see `spawnGtdUiAndHandOff`'s identical
      // comment for why, not `liveHeadSha`.
      const headSha = execSync("git rev-parse HEAD", { cwd: this.repoDir, encoding: "utf8" }).trim()
      const content = readFileSync(join(this.repoDir, filePath), "utf8")
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      await client.done.mutate(
        doneNoteRequest(filePath, headSha, contentHashOf(content), mode, text),
      )
    } finally {
      this.restoreTlsReject(previousTlsReject)
    }

    await this.recordSpawnedExit(exited)
  }

  /** Runs the whole CLI shell (`runCli`) through a capturing `CliIo` backed by the in-memory layers. */
  async runGtdInMem(...args: string[]): Promise<void> {
    const repo = this.repo!
    const { io, result } = makeCapturingCliIo(repo, this.envVars)

    const argv = ["node", "gtd.js", ...args]

    await Effect.runPromise(runCli(argv, io))
    this.lastResult = result()
  }

  // ── Observation helpers — branch on tier ──────────────────────────────────

  repoFileExists(path: string): boolean {
    if (this.repo !== undefined) return this.repo.hasPath(path)
    return existsSync(join(this.repoDir, path))
  }

  /** Empty string when `path` is absent. */
  readRepoFile(path: string): string {
    if (this.repo !== undefined) return this.repo.readFile(path) ?? ""
    return existsSync(join(this.repoDir, path))
      ? readFileSync(join(this.repoDir, path), "utf8")
      : ""
  }

  gitLog(): string {
    if (this.repo !== undefined) {
      const history = this.repo.commitHistory()
      return (
        history
          .slice()
          .reverse()
          .map((c) => `${c.hash.slice(0, 7)} ${c.message}`)
          .join("\n") + "\n"
      )
    }
    return execSync("git log --oneline", {
      cwd: this.repoDir,
      encoding: "utf-8",
    })
  }

  lastCommitPrefix(): string {
    if (this.repo !== undefined) {
      return this.lastCommitSubject().slice(0, 2)
    }
    return execSync('git log -1 --format="%s"', {
      cwd: this.repoDir,
      encoding: "utf-8",
    })
      .trim()
      .slice(0, 2)
  }

  lastCommitSubject(): string {
    if (this.repo !== undefined) {
      const subject = this.repo.lastCommitSubject()
      if (subject === null) throw new Error("No commits in in-memory repo")
      return subject
    }
    return execSync('git log -1 --format="%s"', {
      cwd: this.repoDir,
      encoding: "utf-8",
    }).trim()
  }

  lastCommitBody(): string {
    if (this.repo !== undefined) {
      // InMemRepo stores only the full message; body is everything after the first line.
      const history = this.repo.commitHistory()
      if (history.length === 0) throw new Error("No commits in in-memory repo")
      const last = history[history.length - 1]!
      const lines = last.message.split("\n")
      return lines.slice(1).join("\n").trim()
    }
    return execSync('git log -1 --format="%b"', {
      cwd: this.repoDir,
      encoding: "utf-8",
    }).trim()
  }

  commitCount(): number {
    if (this.repo !== undefined) {
      return this.repo.commitHistory().length
    }
    // An unborn HEAD makes `git rev-list --count HEAD` fail rather than print
    // "0" — treat that failure as zero commits.
    try {
      return parseInt(
        execSync("git rev-list --count HEAD", {
          cwd: this.repoDir,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim(),
        10,
      )
    } catch {
      return 0
    }
  }

  /** Porcelain status with untracked files listed individually. */
  gitStatus(): string {
    if (this.repo !== undefined) {
      return this.repo.statusPorcelain()
    }
    return execSync("git status --porcelain -uall", {
      cwd: this.repoDir,
      encoding: "utf-8",
    })
  }

  /**
   * Settles git's "racy git" protection before a `RepoSnapshot` baseline: a
   * freshly committed repo has tracked files whose mtime sits in the same
   * coarse tick as `.git/index`'s, so git rewrites the index on every
   * `git status` until wall-clock time moves past it — this would otherwise
   * make an "unchanged" snapshot comparison flake. `@live` only.
   */
  async settleGitIndex(): Promise<void> {
    this.gitStatus()
    await delay(1100)
    this.gitStatus()
  }

  /**
   * `@live` only — throws against the in-memory tier, which has no real git
   * dir. Resolves `--git-dir` against `repoDir`, never
   * `realpathSync(repoDir)`, so the excluded prefix lands in the same
   * (possibly symlinked, e.g. macOS's `/var` -> `/private/var`) namespace
   * `listFiles(repoDir)` walks — otherwise the comparison never matches and
   * the whole `.git` tree silently folds into `worktreeFiles`.
   */
  snapshotRepo(): RepoSnapshot {
    const gitDirRel = execSync("git rev-parse --git-dir", {
      cwd: this.repoDir,
      encoding: "utf-8",
    }).trim()
    const gitDirAbs = resolve(this.repoDir, gitDirRel)
    return {
      gitDirFiles: fingerprintFiles(gitDirAbs),
      gitStatus: this.gitStatus(),
      worktreeFiles: listFiles(this.repoDir).filter(
        (path) => path !== gitDirRel && !path.startsWith(`${gitDirRel}/`),
      ),
    }
  }

  gitRefExists(ref: string): boolean {
    if (this.repo !== undefined) {
      return this.repo.resolveRef(ref) !== null
    }
    try {
      execSync(`git rev-parse --verify --quiet ${ref}`, {
        cwd: this.repoDir,
        encoding: "utf-8",
        stdio: "pipe",
      })
      return true
    } catch {
      return false
    }
  }

  /** Plain working-tree deletion (no git involvement — what an editor's delete does). */
  deleteWorktreeFile(path: string): void {
    if (this.repo !== undefined) {
      this.repo.deleteFile(path)
      return
    }
    unlinkSync(join(this.repoDir, path))
  }

  execInRepo(cmd: string, args: string[] = []): string {
    return execSync([cmd, ...args].join(" "), {
      cwd: this.repoDir,
      encoding: "utf-8",
      timeout: 120_000,
    })
  }

  /** `git diff --name-only <base>` (base tree vs. the current working tree), sorted — per tier. */
  diffNameOnly(base: string): readonly string[] {
    const paths =
      this.repo !== undefined
        ? this.repo.changedPathsWorktree(base).map((e) => e.path)
        : this.execInRepo("git", ["diff", "--name-only", base]).split("\n").filter(Boolean)
    return [...paths].sort()
  }
}

setWorldConstructor(GtdWorld)
