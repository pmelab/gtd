import { QuickPickleWorld, setWorldConstructor } from "quickpickle"
import type { TestContext } from "vitest"
import type { InfoConstructor, QuickPickleWorldInterface } from "quickpickle"
import { Effect } from "effect"
import { execSync, execFile as execFileCb, spawn } from "node:child_process"
import { promisify } from "node:util"

const execFile = promisify(execFileCb)
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { constants as osConstants, tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { runCli } from "../../../src/Cli.js"
import { makeCapturingCliIo } from "../../../src/testing/cliIo.js"
import { type ScriptedCommand } from "../../../src/testing/Layers.js"
import { InMemRepo } from "../../../src/testing/InMemRepo.js"
import { applyEmittedScript } from "../../../src/testing/EmittedScriptRecognizer.js"
import { EXIT_OK } from "../../../src/ExitCodes.js"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..")
// Exported so hooks.ts's PATH shim execs this SAME bundle, never a globally-installed gtd.
export const GTD_BIN = join(PROJECT_ROOT, "dist/gtd.bundle.mjs")

export type Tier = "live" | "inmem"

/**
 * Commands that print a `required`/`optional` script for a driver to run
 * instead of performing their git effect directly (`land`, `abandon`,
 * `restore`, bare `gtd --entry <state>`). Everything else is a read command
 * with nothing to drive.
 */
const WRITE_COMMAND_TOKENS: ReadonlySet<string> = new Set(["land", "abandon", "restore", "--entry"])

/**
 * `--json`/`--sh` print a structured document, not the runnable script
 * itself — never something `driveWriteCommand` should feed to `sh` as-is.
 */
const requestsStructuredOutput = (args: readonly string[]): boolean =>
  args.includes("--json") || args.includes("--sh")

/** `--entry` takes both spellings, `--entry <state>` and `--entry=<state>`. */
const isWriteCommand = (args: readonly string[]): boolean => {
  if (requestsStructuredOutput(args)) return false
  const first = args[0] ?? ""
  return WRITE_COMMAND_TOKENS.has(first) || first.startsWith("--entry=")
}

/** `gtd land` exits `EXIT_OK` on any successful landing; only a refusal or usage error has nothing to drive. */
const landExitDrivable = (exitCode: number): boolean => exitCode === EXIT_OK

/**
 * Reverses `src/Sh.ts`'s `shQuote` for one named assignment inside a
 * `--sh` document — `undefined` when the variable is absent (the `unset`
 * preamble, never emitted as a bare name). Package 02 dropped plain
 * `gtd land`'s script output, so the e2e harness now drives `gtd land --sh`'s
 * own `gtd_script` field instead of raw stdout.
 */
const unquoteShAssignment = (doc: string, varName: string): string | undefined => {
  const match = new RegExp(`\\n${varName}='((?:[^']|'\\\\'')*)'`).exec(doc)
  return match?.[1]?.replace(/'\\''/g, "'")
}

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

  /** Canned `bash` command behaviors for the in-memory tier's `CommandRunner`, since real subprocess execution is unreachable against an in-memory worktree. */
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
   * `--cost`/`--model`) is driven off a SECOND, `--sh`-suffixed call's own
   * `gtd_script` field instead of the first call's (now prose) stdout.
   * `lastResult` keeps the first call's own wording/exit code — a scenario's
   * "it succeeds"/stdout assertion still describes the invocation it asked
   * for — and is overridden only when the driven script itself fails.
   */
  private async driveLandWrite(args: readonly string[]): Promise<void> {
    this.lastScriptOutput = ""
    const reported = this.lastResult
    await this.invokeGtd(...args, "--sh")
    const script = unquoteShAssignment(this.lastResult.stdout, "gtd_script")
    this.lastResult = reported
    if (script === undefined || script.length === 0) return
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
    const testCommandEnv =
      this.gtdTestCommandOverride !== undefined
        ? { GTD_TESTCOMMAND: this.gtdTestCommandOverride }
        : {}
    return {
      ...process.env,
      ...pathEnv,
      ...testCommandEnv,
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
   * `gtd land --sh` (never bare `gtd land`, which prints prose since
   * package 02) piped through `sh`, exactly as `docs/driver.md`'s reference
   * driver does: capture the `--sh` document, `eval` it to bind `$gtd_script`,
   * then pipe THAT into `sh`.
   */
  async runGtdLandPiped(): Promise<void> {
    const pipeline = `out="$(${JSON.stringify(process.execPath)} ${JSON.stringify(GTD_BIN)} land --sh)"; gtd_land_status=$?; eval "$out"; printf '%s\n' "$gtd_script" | sh || gtd_land_status=$?; exit "$gtd_land_status"`
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
   * `gtd land --json=script` piped directly into `sh` — the `--json=<path>`
   * twin of `runGtdLandPiped`'s `--sh` scenario. Unlike `--sh` (a whole
   * document that must be `eval`ed to bind `$gtd_script` first), a `--json=`
   * VALUE selection writes the selected field's raw text straight to stdout
   * (`Select.ts`'s `toSelection` on a string scalar is just `String(value)`,
   * newlines and all) — so the script is pipeable with no intermediate eval.
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
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("exit", (code, sig) => resolve({ code, signal: sig }))
      },
    )
    await new Promise<void>((resolve) => child.once("spawn", () => resolve()))
    await delay(300)
    child.kill(signal)
    const { code, signal: died } = await exited
    this.lastSignalExit = { code, signal: died, status: signalExitStatus(code, died) }
  }

  /** Runs the whole CLI shell (`runCli`) through a capturing `CliIo` backed by the in-memory layers. */
  async runGtdInMem(...args: string[]): Promise<void> {
    const repo = this.repo!
    const { io, result } = makeCapturingCliIo(repo, this.envVars, this.scriptedCommands)

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
