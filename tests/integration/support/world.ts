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
  chmodSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { constants as osConstants, tmpdir } from "node:os"
import { join, relative, resolve, sep } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { runCli, runLauncher } from "../../../src/cli/index.js"
import { runJudge } from "../../../src/judges/index.js"
import { inMemoryJudgeIo, type ScriptedClaude } from "./judge-io.js"
import { EXIT_OK, PIN_PATH } from "../../../src/wire/index.js"
import {
  makeCapturingCliIo,
  inMemPinFile,
  type ScriptedCommand,
  InMemRepo,
  applyEmittedScript,
} from "../../../src/twins/index.js"
import { type DiffResult, type ServeRecord, type UiHandler } from "../../../src/ui/index.js"
import { fakeTailnet, type FakeTailnet } from "./ui-host.js"
import type { SteeringView } from "../../../src/steering/index.js"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..")
// Exported so hooks.ts's PATH shim execs this SAME bundle, never a globally-installed gtd.
export const GTD_BIN = join(PROJECT_ROOT, "dist/gtd.bundle.mjs")

// The gate shim's marker poll: how often, and how long before giving up.
const GIT_GATE_POLL_INTERVAL_MS = 10
const GIT_GATE_TIMEOUT_MS = 10_000

export type Tier = "live" | "inmem"

/** A raw HTTP request as a scenario writes it: request line, header lines, a blank line, the body. */
export const parseRawRequest = (
  raw: string,
): { method: string; path: string; headers: Headers; body?: string } => {
  const [head = "", body] = raw.split(/\n\n/, 2)
  const [requestLine = "", ...headerLines] = head.split("\n")
  const [method = "GET", path = "/"] = requestLine.trim().split(/\s+/)
  const headers = new Headers()
  for (const line of headerLines) {
    const colon = line.indexOf(":")
    headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  return { method, path, headers, ...(body !== undefined ? { body } : {}) }
}

/**
 * Commands that print a `required`/`optional` script for a driver to run
 * instead of performing their git effect directly (`land`, `abandon`,
 * `restore`, `repin`, `gtd start <name>`). Everything else is a read command with nothing to drive.
 */
const WRITE_COMMAND_TOKENS: ReadonlySet<string> = new Set(["land", "abandon", "restore", "repin"])

/**
 * `--json` (bare or `--json=<path>`) prints a structured document, not the
 * runnable script itself — never something `driveWriteCommand` should feed
 * to `sh` as-is.
 */
const requestsStructuredOutput = (args: readonly string[]): boolean =>
  args.some((a) => a === "--json" || a.startsWith("--json="))

const isWriteCommand = (args: readonly string[]): boolean =>
  !requestsStructuredOutput(args) && (WRITE_COMMAND_TOKENS.has(args[0] ?? "") || startsByName(args))

/** Bare `gtd start` lists what starts; only a named one prints a script. */
const startsByName = (args: readonly string[]): boolean =>
  args[0] === "start" && args.slice(1).some((arg) => !arg.startsWith("-"))

/** `gtd land` exits `EXIT_OK` on any successful landing; only a refusal or usage error has nothing to drive. */
const landExitDrivable = (exitCode: number): boolean => exitCode === EXIT_OK

/** The one line of a possibly multi-document stdout that parses as a JSON object. */
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

/** A real `sh` exit + combined output on the live tier, or the in-memory twin's on the in-memory one. */
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
  if (applied.ok) return { exitCode: 0, output: applied.output }
  const error = applied.error ?? ""
  if (error.startsWith("unrecognized script block:")) {
    throw new Error(
      `the in-memory tier could not apply an emitted script — ${error}\n` +
        `Teach src/twins/EmittedScriptRecognizer.ts about it.\nScript:\n${script}`,
    )
  }
  return { exitCode: applied.status, output: applied.output }
}

/** Includes mtime, not just content, since a rewrite that lands the same bytes still bumps it. */
interface FileFingerprint {
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
}

/** A point-in-time fingerprint of the repo. `@live` only: the in-memory tier has no git dir to observe. */
export type RepoSnapshot =
  | {
      readonly gitDirFiles: readonly FileFingerprint[]
      readonly gitStatus: string
      readonly worktreeFiles: readonly string[]
    }
  | { readonly inMemory: string }

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

/** Writes a `git` shim into `dir` that parks the first `git log --first-parent` call (recording its pid in `$GTD_TEST_GIT_GATE`) and execs the real git, resolved to an absolute path now, otherwise. */
function writeGitGateShim(dir: string): void {
  const realGit = execSync("command -v git", { encoding: "utf-8" }).trim()
  const shim = join(dir, "git")
  writeFileSync(
    shim,
    `#!/bin/sh
if [ -n "$GTD_TEST_GIT_GATE" ] && [ ! -e "$GTD_TEST_GIT_GATE" ]; then
  case " $* " in
    *" log "*"--first-parent"*)
      echo $$ > "$GTD_TEST_GIT_GATE"
      exec sleep 30
      ;;
  esac
fi
exec ${JSON.stringify(realGit)} "$@"
`,
  )
  chmodSync(shim, 0o755)
}

/** Polls for the gate's pid marker; false on timeout. */
async function waitForGateMarker(marker: string): Promise<boolean> {
  const deadline = Date.now() + GIT_GATE_TIMEOUT_MS
  while (!existsSync(marker) || readFileSync(marker, "utf-8").trim() === "") {
    if (Date.now() > deadline) return false
    await delay(GIT_GATE_POLL_INTERVAL_MS)
  }
  return true
}

/** The POSIX-style `$?` for a `(code, signal)` exit pair: 128 + the signal's number on a signal death, `code` otherwise. */
const signalExitStatus = (code: number | null, signal: NodeJS.Signals | null): number =>
  signal !== null ? 128 + (osConstants.signals[signal] ?? 0) : (code ?? 0)

/** `{ [key]: value }` when `value` is set, `{}` when it's `undefined` — `spawnEnv`'s own building block for each of its several optional overrides, so adding one more never adds another branch there. */
const optionalEnv = (key: string, value: string | undefined): NodeJS.ProcessEnv =>
  value !== undefined ? { [key]: value } : {}

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
   * Reset at the start of every `driveWriteCommand` call so a
   * scenario never reads a stale prior command's output.
   */
  lastScriptOutput: string = ""
  savedScript: string = ""
  /** The handler of the `gtd ui` running in memory, once it has bound. */
  uiHandler: UiHandler | undefined = undefined
  /** `~/.gtd/serve` in memory. */
  serveRecords = new Map<number, ServeRecord>()
  /** The tailnet a fake `tailscale` reports in memory. */
  tailnet: FakeTailnet = fakeTailnet()
  /** Files outside the repository in memory, by absolute path — user-level config. */
  userFiles = new Map<string, string>()
  /** The judge's network in memory: what a stubbed server would answer. */
  judgeFetch: typeof fetch | undefined = undefined
  /** The in-memory `claude`: absent from PATH until a scenario scripts it. */
  scriptedClaude: ScriptedClaude | undefined = undefined
  /** Every in-memory `claude` call's argv, oldest first. */
  claudeCalls: string[][] = []
  savedCommitCount: number | undefined = undefined
  /** Named JSON fields captured from a prior `--json` output — lets a scenario prove two turns' values for the same field are the same or different without knowing the exact value in advance. */
  recordedJsonFields: Record<string, string | undefined> = {}
  /** Named sets of top-level JSON keys captured from a prior `--json` stdout — for a drift guard proving a later document (e.g. `gtd guide`'s briefing) still names every field a real command emits. */
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
  /** The `step` status a spawned `gtd ui` answered right after its `done` — proof `done` leaves the server running. */
  uiStepAfterDone: string | undefined = undefined
  /** Whether the spawned `gtd next` was still alive (neither exited nor already signalled) the instant before `spawnGtdNextAndSignal` sent its signal — proves the process was actually there to interrupt, not racing its own natural exit. `@live` only. */
  signalAliveAtSend: boolean | undefined = undefined
  /** Baseline byte count `runGtdNextRedirectedAndPiped`'s piped count is compared against, to prove a large artifact is never truncated. `@live` only. */
  directRedirectByteCount: number | undefined = undefined
  /** Byte count reaching a deliberately slow pipe consumer, set alongside `directRedirectByteCount`. `@live` only. */
  pipedByteCount: number | undefined = undefined
  /** Path to a stub agent script for `driver-doc` scenarios (@live only) — the `claude` shim translates the docs/driver.md driver's argv into this stub's `$GTD_LOOP_*` env. */
  stubAgentPath: string | undefined = undefined
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
  /** Package 04's own `diff` proof: a real `gtd ui` subprocess, a real `diff` query against it — stashed for a later `Then` step to assert a range's resolved shape (hunk lines, the whole-file banner, or a pure-deletion fallback) against. */
  lastDiffResult: DiffResult | undefined = undefined
  /** The status `gtd ui` answered the last raw request with. */
  lastUiStatus: number | undefined = undefined
  /** Package 01 Task 10's own stale-write proof: the typed refusal `spawnGtdUiAndSetValueWithStaleHash` reads off a real rejected `setValue` mutation, or `undefined` if the write unexpectedly succeeded. */
  lastWriteRefusal: { readonly reason: string; readonly moved?: string } | undefined = undefined
  /** A temp dir OUTSIDE the repo holding a doc's extracted bash paste (the minimal driver, the run-gtd worked example) — proves the paste needs nothing inside the project. */
  pasteDir: string | undefined = undefined
  /** Absolute path to the extracted paste inside `pasteDir`, chmod'd executable. */
  pastePath: string | undefined = undefined

  /** The gtd bundle a live spawn runs: this build's, or one installed from the packed tarball. */
  gtdBin: string = GTD_BIN

  /** Env vars the in-memory tier's `EnvVars` layer exposes — never mutates the real `process.env`. */
  envVars: Record<string, string> = {}

  /** Teardown callbacks for servers a step started (the judge stub server); run by the `After` hook. */
  closers: (() => Promise<void>)[] = []

  /** Extra env vars merged into every LIVE-tier subprocess's environment, overriding `process.env` — never the real `process.env` itself. `@live` only. */
  liveEnvOverrides: Record<string, string> = {}
  /** Names stripped from the inherited `process.env` of every live spawn, so a scenario never depends on the ambient environment. */
  unsetEnvVars: string[] = []
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
  }

  /**
   * Takes a pin or unpin beat the way a driver that ignores the mark does:
   * runs the beat's script, then lands. Throws when the beat is anything else.
   */
  async runPinBeat(mark: "add" | "remove"): Promise<void> {
    await this.invokeGtd("next", "--json")
    const beat = firstJsonObject(this.lastResult.stdout)
    if (beat?.["pin"] !== mark) {
      throw new Error(
        `expected a pin beat marked "${mark}", got: ${this.lastResult.stdout}${this.lastResult.stderr}`,
      )
    }
    const run = await this.runEmittedScript(stringField(beat, "content"))
    if (run.exitCode !== 0) throw new Error(`the ${mark} beat's script failed: ${run.output}`)
    await this.runGtd("land")
  }

  /** Takes a script beat the way a reference driver does: runs its content, then lands. */
  async runScriptBeat(): Promise<void> {
    await this.invokeGtd("next", "--json")
    const beat = firstJsonObject(this.lastResult.stdout)
    if (beat?.["kind"] !== "script") {
      throw new Error(
        `expected a script beat, got: ${this.lastResult.stdout}${this.lastResult.stderr}`,
      )
    }
    const run = await this.runEmittedScript(stringField(beat, "content"))
    if (run.exitCode !== 0) throw new Error(`the script beat failed: ${run.output}`)
    await this.runGtd("land")
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

  /** Captures `gtd land --json=script` WITHOUT running it, so a scenario can change the tree before the script does. */
  async saveLandScript(): Promise<void> {
    await this.invokeGtd("land", "--json=script")
    this.savedScript = this.lastResult.stdout
  }

  /** Combined script output lands in `stderr` (stdout is blanked), so a stderr assertion cannot tell the stream apart. */
  async runSavedScript(): Promise<void> {
    const run = await this.runEmittedScript(this.savedScript)
    this.lastResult = { exitCode: run.exitCode, stdout: "", stderr: run.output }
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

  async runEmittedScript(script: string): Promise<EmittedRun> {
    return this.repo !== undefined
      ? applyScriptToFake(this.repo, this.scriptedCommands, script)
      : this.runScriptWithSh(script)
  }

  /** Real `sh`, with the PATH shim in scope so a script's bare `gtd` resolves to this build. */
  async runScriptWithSh(script: string): Promise<EmittedRun> {
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
  spawnEnv(): NodeJS.ProcessEnv {
    const pathEnv = this.pathShimDir
      ? { PATH: `${this.pathShimDir}:${process.env["PATH"] ?? ""}` }
      : {}
    const inherited = { ...process.env }
    for (const name of this.unsetEnvVars) delete inherited[name]
    return {
      ...inherited,
      ...pathEnv,
      ...optionalEnv("GTD_TEST_TAILSCALE_DIR", this.tailscaleStateDir),
      ...this.envVars,
      ...this.liveEnvOverrides,
      NODE_OPTIONS: undefined,
    }
  }

  // fallow-ignore-next-line complexity
  async runGtdLive(...args: string[]): Promise<void> {
    const verbose = process.env["GTD_E2E_VERBOSE"] === "1"
    try {
      const { stdout, stderr } = await execFile(process.execPath, [this.gtdBin, ...args], {
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
   * The e2e driver's own stdin-piping counterpart of `invokeGtd` — `gtd judge
   * answer` (`.gtd/packages/01-judgment-surface.md` Task 4) is the first
   * command that reads stdin, so this is the first place the harness needs to
   * pipe anything into a spawned/in-process gtd at all.
   */
  private async invokeGtdWithStdin(stdin: string, ...args: string[]): Promise<void> {
    if (this.tier === "inmem") {
      await this.runGtdInMemWithStdin(stdin, ...args)
    } else {
      await this.runGtdLiveWithStdin(stdin, ...args)
    }
  }

  /** Read-only: pipes `stdin` into gtd and stops — never drives an emitted script. */
  async runGtdWithStdin(stdin: string, ...args: string[]): Promise<void> {
    await this.invokeGtdWithStdin(stdin, ...args)
  }

  /**
   * `gtd judge answer`'s own write-driving counterpart of `driveLandWrite`:
   * plain output carries no runnable script (same discipline as plain `gtd
   * land`, package 02), so a successful answer is re-invoked with
   * `--json=script` — stdin fed a SECOND time, since each invocation reads it
   * to completion exactly once — and that script is what actually lands the
   * `Gtd-Judge:` trailer and the transition `routes:` decided.
   */
  async runGtdJudgeAnswerWithStdin(stdin: string): Promise<void> {
    await this.invokeGtdWithStdin(stdin, "judge", "answer")
    if (!landExitDrivable(this.lastResult.exitCode)) return
    const reported = this.lastResult
    await this.invokeGtdWithStdin(stdin, "judge", "answer", "--json=script")
    const script = this.lastResult.stdout
    this.lastResult = reported
    if (script.length === 0) return
    const run = await this.runEmittedScript(script)
    this.lastScriptOutput = run.output
    if (run.exitCode === 0) return
    this.lastResult = {
      exitCode: run.exitCode,
      stdout: reported.stdout,
      stderr: reported.stderr + run.output,
    }
  }

  /**
   * Real `child_process.spawn`, not `execFile` — an async `execFile` has no
   * `input` option (only its sync counterpart does), so writing to the
   * child's own `stdin` stream directly is the only way to pipe data into a
   * REAL gtd subprocess.
   */
  private async runGtdLiveWithStdin(stdin: string, ...args: string[]): Promise<void> {
    const verbose = process.env["GTD_E2E_VERBOSE"] === "1"
    const child = spawn(process.execPath, [this.gtdBin, ...args], {
      cwd: this.repoDir,
      env: this.spawnEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    const exited = new Promise<number>((resolve) => {
      child.once("close", (code) => resolve(code ?? 1))
    })
    child.stdin?.end(stdin)
    const exitCode = await exited
    if (verbose) {
      process.stderr.write(stdout)
      process.stderr.write(stderr)
    }
    this.lastResult = { exitCode, stdout, stderr }
  }

  private async runGtdInMemWithStdin(stdin: string, ...args: string[]): Promise<void> {
    this.lastResult = await this.gtdInMemUntil(undefined, stdin, ...args)
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
    const pipeline = `${JSON.stringify(process.execPath)} ${JSON.stringify(this.gtdBin)} land --json=script | sh`
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

  /** What the last `runGtdBundle` printed: a pin is binary, so `lastResult.stdout` cannot hold it. */
  pin: Uint8Array = new Uint8Array()

  /** `gtd bundle`, keeping stdout's bytes in `pin`. */
  async runGtdBundle(): Promise<void> {
    if (this.repo !== undefined) {
      const { io, result } = makeCapturingCliIo(this.repo, this.envVars)
      await Effect.runPromise(runCli(["node", "gtd.js", "bundle"], io))
      const { stdoutBytes, ...rest } = result()
      this.lastResult = rest
      this.pin = stdoutBytes
      return
    }
    const run = await execFile(process.execPath, [this.gtdBin, "bundle"], {
      cwd: this.repoDir,
      env: this.spawnEnv(),
      encoding: "buffer",
      maxBuffer: Infinity,
      timeout: 30_000,
    }).then(
      (done) => ({ exitCode: 0, ...done }),
      (err: { code?: unknown; stdout: Buffer; stderr: Buffer }) => ({
        exitCode: typeof err.code === "number" ? err.code : 1,
        ...err,
      }),
    )
    this.lastResult = {
      exitCode: run.exitCode,
      stdout: run.stdout.toString("latin1"),
      stderr: run.stderr.toString(),
    }
    this.pin = run.stdout
  }

  /** `@live` only — runs `command` under `sh -c` in the repo, so a scenario can spell out a real pipe between gtd invocations. */
  async runShell(command: string, timeout = 30_000): Promise<void> {
    if (this.repo !== undefined) return this.runPipelineInMem(command)
    try {
      const { stdout, stderr } = await execFile("sh", ["-c", command], {
        cwd: this.repoDir,
        env: this.spawnEnv(),
        encoding: "utf-8",
        timeout,
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
    const bin = `${JSON.stringify(process.execPath)} ${JSON.stringify(this.gtdBin)}`
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
   * `@live` only — spawns `gtd next` behind a per-spawn `git` shim that parks
   * the first `git log --first-parent` call (the async `commitHistory` read),
   * signals the child once the shim's marker proves it is parked there, then
   * records how it died. Delivers `signal` to the spawned process itself.
   *
   * The gate is an ASYNC child process on purpose: the fiber is suspended, so
   * the runtime's signal listener runs, interrupts it and `main.ts` re-raises.
   * A sync git call would block the main thread. The marker exists only after
   * `main.ts` registered its listeners, so a default-disposition death cannot
   * pass for the re-raise. `code === null && signal` set distinguishes a
   * re-raised signal from a `process.exit(130)`.
   */
  async spawnGtdNextAndSignal(signal: NodeJS.Signals): Promise<void> {
    const gateDir = mkdtempSync(join(tmpdir(), "gtd-git-gate-"))
    const marker = join(gateDir, "marker")
    writeGitGateShim(gateDir)
    const env = this.spawnEnv()
    env["PATH"] = `${gateDir}:${env["PATH"] ?? ""}`
    env["GTD_TEST_GIT_GATE"] = marker
    try {
      await this.signalAtMarker(
        ["next"],
        env,
        marker,
        signal,
        "gtd next never reached `git log --first-parent`",
      )
    } finally {
      try {
        process.kill(Number(readFileSync(marker, "utf-8").trim()), "SIGKILL")
      } catch {
        // marker absent or sleep already gone
      }
      rmSync(gateDir, { recursive: true, force: true })
    }
  }

  /** Spawns gtd, waits for `marker` to name a pid, then signals gtd and records how it died. */
  private async signalAtMarker(
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    marker: string,
    signal: NodeJS.Signals,
    timeoutMessage: string,
  ): Promise<void> {
    const child = spawn(process.execPath, [this.gtdBin, ...args], {
      cwd: this.repoDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    // `close`, not `exit`: waits for stdio to drain.
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("close", (code, sig) => resolve({ code, signal: sig }))
      },
    )
    child.stdout?.resume()
    child.stderr?.resume()
    if (!(await waitForGateMarker(marker))) {
      child.kill("SIGKILL")
      await exited
      assert.fail(timeoutMessage)
    }
    this.signalAliveAtSend = child.exitCode === null && child.signalCode === null
    child.kill(signal)
    const { code, signal: died } = await exited
    this.lastSignalExit = { code, signal: died, status: signalExitStatus(code, died) }
  }

  /** Runs the whole CLI shell (`runCli`) through a capturing `CliIo` backed by the in-memory layers. */
  async runGtdInMem(...args: string[]): Promise<void> {
    this.lastResult = await this.gtdInMem(...args)
  }

  /**
   * A `gtd … | gtd … | sh` pipeline in memory: each gtd reads the previous
   * stdout as its stdin, and a closing `sh` runs the last one's script on the
   * in-memory shell. Like `sh` without `pipefail`, the last command's status
   * is the pipeline's.
   */
  private async runPipelineInMem(command: string): Promise<void> {
    let stdin = ""
    let stderr = ""
    let last = { exitCode: 0, stdout: "", stderr: "" }
    for (const segment of command.trim().split(/\s*\|\s*/)) {
      last = await this.runSegmentInMem(segment, stdin)
      stdin = last.stdout
      stderr += last.stderr
    }
    this.lastResult = { exitCode: last.exitCode, stdout: last.stdout, stderr }
  }

  private async runSegmentInMem(
    segment: string,
    stdin: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    if (segment === "sh") {
      const run = await this.runEmittedScript(stdin)
      return { exitCode: run.exitCode, stdout: run.output, stderr: "" }
    }
    if (!segment.startsWith("gtd ")) {
      throw new Error(`cannot run \`${segment}\` in memory — only gtd and sh`)
    }
    const args = segment.slice("gtd ".length).split(/\s+/)
    return this.gtdInMemUntil(undefined, stdin, ...args)
  }

  /** One in-process gtd run against the in-memory repository, leaving `lastResult` alone. */
  async gtdInMem(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.gtdInMemUntil(undefined, "", ...args)
  }

  /** One in-process gtd run, interrupted when `signal` aborts. */
  private async gtdInMemUntil(
    signal: AbortSignal | undefined,
    stdin: string,
    ...args: string[]
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    // `gtd judge run` is the one tool command `@inmem` scenarios run for real.
    const judgeIo = inMemoryJudgeIo(this.repoDir, this.repo!, {
      userFiles: this.userFiles,
      fetch: this.judgeFetch,
      claude: this.scriptedClaude,
      calls: this.claudeCalls,
    })
    const { io, result } = makeCapturingCliIo(
      this.repo!,
      this.envVars,
      {
        judge: (request) => runJudge({ ...request, io: judgeIo }),
      },
      stdin,
    )
    const run = (argv: readonly string[]) =>
      Effect.runPromise(runCli(argv, io), { signal }).catch((error: unknown) => {
        if (signal?.aborted !== true) throw error
      })
    // The in-memory pin carries no engine: this same one stands in for it.
    await runLauncher(
      ["node", "gtd.js", ...args],
      inMemPinFile(this.repo!, this.repoDir, PIN_PATH),
      {
        stdout: io.stdout,
        stderr: io.stderr,
        exit: io.exit,
        live: run,
        pin: (launch) => run(launch.argv),
      },
    )
    return result()
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
   * make an "unchanged" snapshot comparison flake. The in-memory repo has
   * no index on disk to refresh.
   */
  async settleGitIndex(): Promise<void> {
    if (this.repo !== undefined) return
    this.gitStatus()
    await delay(1100)
    this.gitStatus()
  }

  /**
   * Live: resolves `--git-dir` against `repoDir`, never
   * `realpathSync(repoDir)`, so the excluded prefix lands in the same
   * (possibly symlinked, e.g. macOS's `/var` -> `/private/var`) namespace
   * `listFiles(repoDir)` walks — otherwise the comparison never matches and
   * the whole `.git` tree silently folds into `worktreeFiles`.
   */
  snapshotRepo(): RepoSnapshot {
    if (this.repo !== undefined) return { inMemory: this.repo.snapshot() }
    const gitDirRel = execSync("git rev-parse --git-dir", {
      cwd: this.repoDir,
      encoding: "utf-8",
    }).trim()
    const gitDirAbs = resolve(this.repoDir, gitDirRel)
    return {
      // `gtd-cache/` (under the git COMMON dir) is a deliberate read-side
      // effect — package 4's on-disk tree/blob cache, populated by ordinary
      // reads by design (Requirement B) — not a mutation these scenarios
      // exist to catch, so it's excluded the same way `gitStatus`/
      // `worktreeFiles` exclude the git dir itself.
      gitDirFiles: fingerprintFiles(gitDirAbs).filter(
        (f) => f.path !== "gtd-cache" && !f.path.startsWith(`gtd-cache${sep}`),
      ),
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
