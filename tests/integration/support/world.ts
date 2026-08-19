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
import { EXIT_AGENT_TURN, EXIT_HUMAN_TURN, EXIT_OK } from "../../../src/ExitCodes.js"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..")
// Exported so `hooks.ts`'s PATH shim (a `gtd` shell script on the live tier's
// PATH, for anything the spawned process itself shells out to by name — see
// `pathShimDir` below) execs this SAME bundle, never a globally-installed gtd.
export const GTD_BIN = join(PROJECT_ROOT, "dist/gtd.bundle.mjs")

export type Tier = "live" | "inmem"

/**
 * The tokens whose command no longer performs its git effect itself but
 * PRINTS it as a `required`/`optional` script pair for a driver to run
 * (`land`, `abandon`, `restore`, and the bare `gtd --entry <state>` short
 * form — the only form `--entry` has: landing and entering are different
 * verbs, so `gtd land --entry <state>` is a usage error, not a write command
 * of its own). Everything else is a read command with nothing to drive.
 */
const WRITE_COMMAND_TOKENS: ReadonlySet<string> = new Set(["land", "abandon", "restore", "--entry"])

/** `--entry` takes both spellings (`--entry <state>` and `--entry=<state>`), so the bare short form has to be recognized either way. */
const isWriteCommand = (args: readonly string[]): boolean => {
  const first = args[0] ?? ""
  return WRITE_COMMAND_TOKENS.has(first) || first.startsWith("--entry=")
}

/**
 * The three drivable exit codes ANY command now reports — `EXIT_OK` (0,
 * nothing owed), `EXIT_AGENT_TURN` (10) and `EXIT_HUMAN_TURN` (20), all of
 * which still carry a script/beat for a driver to act on — as opposed to a
 * genuine refusal (`EXIT_RUNTIME_ERROR`, 1) or a usage error
 * (`EXIT_USAGE_ERROR`, 2), which have nothing to drive.
 */
const landExitDrivable = (exitCode: number): boolean =>
  exitCode === EXIT_OK || exitCode === EXIT_AGENT_TURN || exitCode === EXIT_HUMAN_TURN

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

/** What running one emitted script produced — a real `sh` exit + combined output on the live tier, the recognizer's verdict on the in-memory one. */
interface EmittedRun {
  readonly exitCode: number
  readonly output: string
}

/** A rejected `execFile` promise, read back as an `EmittedRun`. */
const execFailure = (err: unknown): EmittedRun => {
  const e = err as { code?: unknown; stdout?: string; stderr?: string }
  return {
    exitCode: typeof e.code === "number" ? e.code : 1,
    output: (e.stdout ?? "") + (e.stderr ?? ""),
  }
}

/** A rejected `execFile` promise, read back as a `GtdWorld.lastResult` (stdout/stderr kept separate, unlike `execFailure`'s combined `output`). */
const execFailureResult = (err: unknown): { exitCode: number; stdout: string; stderr: string } => {
  const e = err as { code?: unknown; stdout?: string; stderr?: string }
  return {
    exitCode: typeof e.code === "number" ? e.code : 1,
    stdout: e.stdout ?? "",
    stderr: e.stderr ?? "",
  }
}

/**
 * In-memory tier: apply an emitted script to the fake through
 * `EmittedScriptRecognizer`. Its refusal on a block it does not know is
 * THROWN rather than returned as an exit code — that refusal is the property
 * keeping the fake honest (a builder added without teaching the recognizer
 * must fail the suite loudly, never masquerade as a script that legitimately
 * failed).
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

/** One file's identity for `RepoSnapshot` purposes: path, size, and mtime — a rewrite that lands the same bytes still bumps mtime, so this catches a write a content-only diff would miss. */
interface FileFingerprint {
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
}

/**
 * A point-in-time fingerprint of the whole repository — every file under the
 * git dir (fingerprinted, not just listed, since a same-content rewrite is
 * still a write), `git status --porcelain`, and the full worktree file
 * listing. Two snapshots of an untouched repository compare
 * `assert.deepStrictEqual`. `@live` only: the in-memory tier has no git dir
 * for this to observe.
 */
export interface RepoSnapshot {
  readonly gitDirFiles: readonly FileFingerprint[]
  readonly gitStatus: string
  readonly worktreeFiles: readonly string[]
}

/** Every regular file under `root`, as paths relative to `root`, sorted for a stable comparison. */
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

/**
 * The POSIX-style `$?` a shell reads off a `ChildProcess` "exit" event's own
 * `(code, signal)` pair — 128 + the signal's number on a signal death, `code`
 * (0 if somehow null) otherwise. Split out of `spawnGtdNextAndSignal` as a
 * plain function of its two inputs so that method stays a thin orchestrator.
 */
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
  // loses its base class's members from TS's view entirely (a resolution
  // quirk with this package's dual CJS/ESM `exports` map) — re-declaring the
  // one field `hooks.ts`'s `Before` callback reads restores it.
  declare info: QuickPickleWorldInterface["info"]

  constructor(context: TestContext, info: InfoConstructor) {
    super(context, info)
  }

  repoDir!: string
  /** An extra directory (an ancestor of `repoDir`) the After hook must also remove — set when a scenario nests the repo under a purpose-built parent. */
  extraCleanupDir: string | undefined = undefined
  /** In-memory repo for the `inmem` tier. When set, file/git ops use this instead of repoDir. */
  repo: InMemRepo | undefined = undefined
  /** Which execution tier is active for this scenario. Set by the Before hook. */
  tier: Tier = "inmem"

  lastResult: { exitCode: number; stdout: string; stderr: string } = {
    exitCode: 0,
    stdout: "",
    stderr: "",
  }
  /**
   * The combined output of the `required`/`optional` scripts the last write
   * command (`land`/`--entry`/`abandon`/`restore`) drove — distinct from
   * `lastResult.stdout`, which carries gtd's OWN plain-text line, not what a
   * driven script printed. Only meaningful on the LIVE tier: a script's
   * outcome lines (`src/OutcomeScript.ts`'s `gtd_report_*` calls) are printed
   * by real `sh`, which the in-memory tier's `applyEmittedScript` never
   * runs (see its own module doc comment's "outcome blocks are inert"
   * decision) — reset to `""` at the start of every `driveWriteCommand` call,
   * so a scenario never reads a STALE prior command's output.
   */
  lastScriptOutput: string = ""
  savedCommitCount: number | undefined = undefined
  /** Named JSON fields captured from a prior `gtd next --json`/`gtd status --json` output (`world.lastResult.stdout`) — for scenarios that must prove two turns' values for the SAME field are the SAME (a memory key's scope, a resumed session id) or DIFFERENT (a fresh scope, a freshly minted id) without knowing the exact value in advance. Keyed by the label a scenario names it, not by field — one vocabulary for any `next --json`/`status --json` field. */
  recordedJsonFields: Record<string, string | undefined> = {}
  /** Named sets of top-level JSON keys captured from a prior `--json` command's stdout — for a drift guard proving a later document (e.g. `gtd install`'s briefing) still names every field a real command emits. Keyed by the label a scenario names it, same vocabulary as `recordedJsonFields`. */
  recordedJsonKeys: Record<string, readonly string[]> = {}
  /** Raw `lastResult.stdout` captured verbatim under a scenario-chosen label — for a poll-safety proof that two runs of the same read command answer byte-identically, not just field-by-field. */
  recordedStdout: Record<string, string | undefined> = {}
  /** A `snapshotRepo()` result saved for later comparison — the repo-mutation counterpart of `recordedStdout`. */
  savedSnapshot: RepoSnapshot | undefined = undefined
  /**
   * The `(code, signal)` pair Node's `ChildProcess` "exit" event reported for
   * the last `spawnGtdNextAndSignal` call, plus the POSIX-style `status` a
   * shell's `$?` would read off that same death (128 + the signal's number).
   * `code === null && signal` set is what tells a re-raised signal apart from
   * a `process.exit(130)` that merely reuses the same number (`code === 130,
   * signal === null`) — see `spawnGtdNextAndSignal`'s own doc comment. `@live`
   * only.
   */
  lastSignalExit:
    | { code: number | null; signal: NodeJS.Signals | null; status: number }
    | undefined = undefined
  /** Byte count of `gtd next`'s stdout redirected straight to a file (`bash -c "gtd next > file"`, no reader-side delay) — the baseline `runGtdNextRedirectedAndPiped`'s piped byte count is compared against, to prove a large artifact is never truncated. `@live` only. */
  directRedirectByteCount: number | undefined = undefined
  /** Byte count of `gtd next`'s stdout that reached a deliberately slow pipe consumer (`bash -c "gtd next | { sleep 2; cat; } > file"`). Set alongside `directRedirectByteCount` by `runGtdNextRedirectedAndPiped`. `@live` only. */
  pipedByteCount: number | undefined = undefined
  /** Path to a stub agent script for `readme-driver` scenarios (@live only) — the `claude` shim on the scenario's PATH translates the README driver's own argv into this stub's `$GTD_LOOP_*` env. */
  stubAgentPath: string | undefined = undefined
  /** Explicit `$GTD_TESTCOMMAND` value a scenario wants exported — overrides the bundled template's `vars.testCommand` for a real `checking`/`fix-precheck` script run (@live only). */
  gtdTestCommandOverride: string | undefined = undefined
  /** A scenario-scoped temp dir holding a `gtd` shim (see hooks.ts's `Before`) so a bare `gtd` invoked BY NAME — e.g. a seeded steering-mode `validate:` command (`gtd check <mode> <file>`) — resolves to this build, not a globally-installed gtd. Set by the Before hook, live tier only. */
  pathShimDir: string | undefined = undefined
  /** A temp dir OUTSIDE the repo holding the README's extracted driver script — proves the paste needs nothing inside the project. Set by "Given the driver pasted from README.md" (`readme-driver.steps.ts`), removed by the After hook alongside `repoDir`. */
  readmeDriverDir: string | undefined = undefined
  /** Absolute path to the extracted driver script inside `readmeDriverDir`, chmod'd executable — what "When I run the README driver" spawns. */
  readmeDriverPath: string | undefined = undefined

  /** Environment variables the in-memory tier's `EnvVars` layer exposes (`it.vars`'s highest-precedence `GTD_<UPPERCASE-name>` layer) — never mutates the real `process.env`. Set by `Given an environment variable "..." set to "..."`. */
  envVars: Record<string, string> = {}

  /** Extra env vars merged into every LIVE-tier subprocess's environment (`spawnEnv()`), overriding `process.env` — e.g. a scenario-relocated `$GIT_DIR`/`$TMPDIR` (`tmpdir-gitdir.steps.ts`). Never mutates the real `process.env`: the test process itself must never export `$GIT_DIR` (see hooks.ts's scrub), only the spawned gtd. `@live` only. */
  liveEnvOverrides: Record<string, string> = {}
  /** The relocated git dir a `tmpdir-gitdir.steps.ts` scenario moved `<repoDir>/.git` to — outside the worktree, so gtd can only find it by honoring `$GIT_DIR`. `@live` only. */
  customGitDir: string | undefined = undefined
  /** The scratch directory a `tmpdir-gitdir.steps.ts` scenario points `$TMPDIR` at — checked empty afterward to prove nothing writes there. `@live` only. */
  customTmpDir: string | undefined = undefined

  /** Canned `bash` command behaviors for the in-memory tier's `CommandRunner` — real subprocess execution is unreachable against an in-memory worktree. Keyed by the rendered command string; set by `Given the shell command "..." ...` (@inmem steering-mode scenarios only). */
  scriptedCommands: Map<string, ScriptedCommand> = new Map()

  /**
   * The e2e DRIVER — the test-suite counterpart of a real driver (the
   * README's minimal driver, or your own). gtd's write commands no longer
   * perform their own git effect: they print a `required`
   * (and sometimes `optional`) POSIX sh script for a driver to run, and `gtd
   * validate` likewise prints the script that formats-then-validates rather
   * than doing it. Every scenario's assertions are about what those scripts
   * DO — the resulting commits, the reformatted file, the findings — so the
   * world has to be the thing that runs them.
   *
   * Invoke the command exactly as the scenario asked (so `lastResult` carries
   * gtd's own wording and exit code verbatim), then drive whatever it
   * emitted. A read command (`next`, `status`, `visualize`, `lsp`, `check`,
   * `init`) emits nothing and falls straight through regardless of its own
   * exit code (0/10/20 all just report whose turn it is next). `gtd land`'s
   * `EXIT_AGENT_TURN`/`EXIT_HUMAN_TURN` still carry a script to run — same as
   * `EXIT_OK` — so the guard below tolerates all three; only a genuine
   * refusal (`EXIT_RUNTIME_ERROR`) or usage error skips driving.
   */
  async runGtd(...args: string[]): Promise<void> {
    await this.invokeGtd(...args)
    if (!landExitDrivable(this.lastResult.exitCode)) return
    if (isWriteCommand(args)) await this.driveWriteCommand()
    else if (args[0] === "validate") await this.driveValidateCommand()
  }

  /** Raw invocation: routes to the live or in-process implementation based on this.tier, with no script driving. */
  private async invokeGtd(...args: string[]): Promise<void> {
    if (this.tier === "inmem") {
      await this.runGtdInMem(...args)
    } else {
      await this.runGtdLive(...args)
    }
  }

  /**
   * `land`/`--entry`/`abandon`/`restore`: run the WHOLE of `lastResult.stdout`
   * as one script — `Emit.ts`'s `combinedScript` is now the only artifact any
   * of these commands print (no more `--json` to split `required`/`optional`
   * out of), sequencing required before optional itself and swallowing the
   * optional half's own failure. gtd's own plain-text line stays as
   * `lastResult`; only a FAILING script overrides it, since a scenario
   * asserting "it succeeds" must not pass when the work never landed.
   */
  private async driveWriteCommand(): Promise<void> {
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
   * `validate`: gtd prints the format-then-validate script as plain text (or
   * `nothing to validate at "<state>"` when there's nothing to run) — the
   * verdict lives in that script's exit code, not the command's. Run it and
   * report the verdict the way a driver does (`validateVerdict`). `validate`
   * itself no longer names the file structurally (`--json` is `gtd status`'s
   * surface alone now), so the file name for the verdict message is probed
   * off a `gtd status --json` call against the SAME rest instead.
   */
  private async driveValidateCommand(): Promise<void> {
    const script = this.lastResult.stdout
    if (NOTHING_TO_VALIDATE_RE.test(script)) return
    const run = await this.runEmittedScript(script)
    const file = await this.currentValidateFile()
    this.lastResult = validateVerdict(file, run)
  }

  /**
   * Probes `gtd status --json`'s `file` field — the resolved rest `gtd
   * validate` just emitted a script for — restoring `lastResult` to gtd's own
   * `validate` output afterwards, exactly like the old `--json` re-invoke
   * this replaces (see AGENTS.md's "one structured surface" decision).
   */
  private async currentValidateFile(): Promise<string> {
    const reported = this.lastResult
    await this.invokeGtd("status", "--json")
    const probe = this.lastResult
    this.lastResult = reported
    const parsed = firstJsonObject(probe.stdout)
    return parsed !== undefined ? stringField(parsed, "file") : ""
  }

  /** Executes one emitted script against whichever repo the tier owns. */
  private async runEmittedScript(script: string): Promise<EmittedRun> {
    return this.repo !== undefined
      ? applyScriptToFake(this.repo, this.scriptedCommands, script)
      : this.runScriptWithSh(script)
  }

  /** Live tier: real `sh` (gtd's own emitted scripts are POSIX sh), in the real worktree, with the PATH shim in scope so a script's bare `gtd` resolves to this build. */
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
   * dir (see hooks.ts's Before) so a bare `gtd` invoked BY NAME — by the
   * process spawned here, or by anything IT spawns — resolves to this same
   * build under test rather than a stray global install. Applies
   * `$GTD_TESTCOMMAND` when a scenario set one (readme-driver.steps.ts's
   * "GTD_TESTCOMMAND is set to"), so both a direct `--entry fix-precheck`
   * invocation and the required/optional script it emits see the override.
   * `liveEnvOverrides` layers on last, highest precedence — e.g. a
   * scenario-relocated `$GIT_DIR`/`$TMPDIR` (tmpdir-gitdir.steps.ts).
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

  /** Async execFile implementation — used for the live tier. */
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
   * `@live` only: proves the CAPTURE-THEN-PIPE landing form (driver
   * obligation 8) — not the bare `gtd land | sh` one-liner it deliberately
   * replaces. A bare pipe needs `bash`'s `set -o pipefail` to make the
   * pipeline's own exit status track gtd's, and POSIX `sh` (dash) has no
   * `pipefail` at all — the whole reason the README's driver and this test
   * both capture `gtd land`'s exit code BEFORE running anything. This
   * mirrors the ported reference driver's own `gtd_land()` exactly: capture
   * `gtd land`'s stdout and exit code first, then pipe the captured script
   * into `sh` — if THAT fails, its exit status overrides (something was run
   * and it broke); otherwise gtd's own captured status stands, whether that
   * is a drivable 0/10/20 or a refusal/usage error that produced no script
   * at all (piping empty input into `sh` succeeds and leaves gtd's own
   * status untouched). `lastResult.exitCode` is that final status, so
   * `it settles`/`it succeeds` read it exactly like any other invocation.
   */
  async runGtdLandPiped(): Promise<void> {
    const pipeline = `gtd_land_script="$(${JSON.stringify(process.execPath)} ${JSON.stringify(GTD_BIN)} land)"; gtd_land_status=$?; printf '%s\n' "$gtd_land_script" | sh || gtd_land_status=$?; exit "$gtd_land_status"`
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
   * `@live` only — proves a large `gtd next` prompt survives its own
   * non-zero exit (`EXIT_AGENT_TURN`, 10) through a pipe under backpressure,
   * the property task 3 of `05-flush-stdout-before-exit.md` exists to pin.
   * Runs the SAME command two ways, each a REAL `bash -c` shell redirect
   * (not this world's own `runGtd`/`driveWriteCommand` machinery, which
   * never touches a real OS pipe):
   *
   *  - direct: `gtd next > <file>` — no reader-side delay, nothing queues;
   *    this is the byte count "nothing was truncated" is measured against
   *  - piped: `gtd next | { sleep 2; cat; } > <file>`, with `set -o
   *    pipefail` so the pipeline's own exit status is `gtd next`'s (10),
   *    never `cat`'s — the sleep holds the reader off long enough that a
   *    fixture sized past the OS pipe buffer forces `process.stdout.write`
   *    to queue, exactly the condition `nodeCliIo.exit` used to race
   *
   * Both byte counts are read back with `statSync` — bash's own redirect
   * writes straight to disk, never back through this process — and
   * `lastResult` is set from the PIPED run's own exit so `it awaits the
   * agent`/`it succeeds` read it exactly like any other invocation. Each
   * half's own non-zero exit (expected — a `prompt` rest's `next` always
   * exits 10) is caught rather than treated as a step failure; only the
   * piped run's final exit code and both byte counts matter here.
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

    const pipeline = `set -o pipefail; ${bin} next | { sleep 2; cat; } > ${JSON.stringify(pipedFile)}`
    try {
      await execFile("bash", ["-c", pipeline], runOpts)
      this.lastResult = { exitCode: 0, stdout: "", stderr: "" }
    } catch (err: unknown) {
      this.lastResult = execFailureResult(err)
    }
    this.pipedByteCount = statSync(pipedFile).size
  }

  /**
   * `@live` only — spawns `gtd next` directly (never through this world's
   * `runGtd`/bash driving, which never leaves a signal-deliverable child
   * process alive to sign) against a prompt padded past the OS pipe buffer,
   * so its own `stdout` write blocks once nothing drains the pipe — the same
   * backpressure `runGtdNextRedirectedAndPiped` relies on, reused here to
   * guarantee the process is still alive (not racing its own natural exit)
   * when the signal arrives. Delivers `signal` to the spawned process
   * itself, not a shell wrapper around it — a signal sent to a wrapper's own
   * pid never reaches a plain (non-`exec`'d) child.
   *
   * Records the POSIX-style `status` a shell's `$?` reads off a signal death
   * (128 + the signal's number) into `lastSignalExit`, alongside the raw
   * `(code, signal)` Node's own "exit" event reported — `code === null` with
   * `signal` set is what tells a re-raised signal apart from a
   * `process.exit(130)` that merely reuses the same number (`code === 130`,
   * `signal === null`), even though both read back the same `status`.
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

  /** In-process implementation — runs the whole CLI shell (`runCli`) through a capturing `CliIo` backed by the in-memory layers. */
  async runGtdInMem(...args: string[]): Promise<void> {
    const repo = this.repo!
    const { io, result } = makeCapturingCliIo(repo, this.envVars, this.scriptedCommands)

    // Compose argv: ["node", "gtd.js", ...args]
    const argv = ["node", "gtd.js", ...args]

    await Effect.runPromise(runCli(argv, io))
    this.lastResult = result()
  }

  // ── Observation helpers — branch on tier ──────────────────────────────────

  repoFileExists(path: string): boolean {
    if (this.repo !== undefined) return this.repo.hasPath(path)
    return existsSync(join(this.repoDir, path))
  }

  /** The working-tree contents of `path` (empty string when absent). Mirrors `repoFileExists`'s tier split. */
  readRepoFile(path: string): string {
    if (this.repo !== undefined) return this.repo.readFile(path) ?? ""
    return existsSync(join(this.repoDir, path))
      ? readFileSync(join(this.repoDir, path), "utf8")
      : ""
  }

  gitLog(): string {
    if (this.repo !== undefined) {
      const history = this.repo.commitHistory()
      // Render in oneline format: "<hash_short> <message>" newest→oldest
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
      // InMemRepo stores only the full message; extract body (lines after first)
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
    // An unborn HEAD (a `git init`'d repository with no commits yet) makes
    // `git rev-list --count HEAD` fail outright rather than print "0" — treat
    // that failure as zero commits rather than letting it throw.
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
   * Settles git's own "racy git" protection before a `RepoSnapshot` baseline
   * is taken: a freshly committed repo has tracked files whose mtime sits in
   * the same (coarse) tick as `.git/index`'s own mtime, so git can't yet
   * trust its cached stat info and REWRITES the index on every `git status`
   * until real wall-clock time moves the index's mtime past the files' — a
   * plain git behavior with nothing to do with gtd, but one that would
   * otherwise make an "unchanged" snapshot comparison flake. `@live` only.
   */
  async settleGitIndex(): Promise<void> {
    this.gitStatus()
    await delay(1100)
    this.gitStatus()
  }

  /**
   * See `RepoSnapshot`'s own doc comment. `@live` only — throws against the
   * in-memory tier, which has no real git dir. `--git-dir` (not
   * `--absolute-git-dir`) resolved AGAINST `repoDir` — never
   * `realpathSync(repoDir)` — so the excluded prefix lands in the same
   * (possibly symlinked, e.g. macOS's `/var` -> `/private/var`) namespace
   * `listFiles(repoDir)` itself walks in; comparing a realpath-resolved git
   * dir against un-resolved worktree paths would never match, silently
   * folding the whole `.git` tree into `worktreeFiles`.
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

  /** Whether a repo-local ref (e.g. `refs/gtd/review-head`) resolves to a commit. */
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
}

setWorldConstructor(GtdWorld)
