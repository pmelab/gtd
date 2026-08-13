import { QuickPickleWorld, setWorldConstructor } from "quickpickle"
import type { TestContext } from "vitest"
import type { InfoConstructor, QuickPickleWorldInterface } from "quickpickle"
import { Effect } from "effect"
import { execSync, execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"

const execFile = promisify(execFileCb)
import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { join, resolve } from "node:path"
import { runCli } from "../../../src/Cli.js"
import { makeCapturingCliIo } from "../../../src/testing/cliIo.js"
import { type ScriptedCommand } from "../../../src/testing/Layers.js"
import { InMemRepo } from "../../../src/testing/InMemRepo.js"
import { applyEmittedScript } from "../../../src/testing/EmittedScriptRecognizer.js"

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

/** `gtd land`'s two drivable exit codes — 0 (ordinary) and 3 (SETTLED, still carrying a script to run) — as opposed to a genuine refusal (1), which has nothing to drive. */
const landExitDrivable = (exitCode: number): boolean => exitCode === 0 || exitCode === 3

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

/** What running one emitted script produced — a real `bash` exit + combined output on the live tier, the recognizer's verdict on the in-memory one. */
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
   * by real `bash`, which the in-memory tier's `applyEmittedScript` never
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

  /** Canned `bash` command behaviors for the in-memory tier's `CommandRunner` — real subprocess execution is unreachable against an in-memory worktree. Keyed by the rendered command string; set by `Given the shell command "..." ...` (@inmem steering-mode scenarios only). */
  scriptedCommands: Map<string, ScriptedCommand> = new Map()

  /**
   * The e2e DRIVER — the test-suite counterpart of a real driver (the
   * README's minimal driver, or your own). gtd's write commands no longer
   * perform their own git effect: they print a `required`
   * (and sometimes `optional`) bash script for a driver to run, and `gtd
   * validate` likewise prints the script that formats-then-validates rather
   * than doing it. Every scenario's assertions are about what those scripts
   * DO — the resulting commits, the reformatted file, the findings — so the
   * world has to be the thing that runs them.
   *
   * Invoke the command exactly as the scenario asked (so `lastResult` carries
   * gtd's own wording and exit code verbatim), then drive whatever it
   * emitted. A read command (`next`, `status`, `visualize`, `lsp`, `check`,
   * `init`) emits nothing and falls straight through. Exit 3 (`gtd land`'s
   * SETTLED signal) still carries a script to run — same as exit 0 — so the
   * guard below tolerates both; only a genuine refusal (exit 1) skips driving.
   */
  async runGtd(...args: string[]): Promise<void> {
    await this.invokeGtd(...args)
    if (!landExitDrivable(this.lastResult.exitCode)) return
    if (isWriteCommand(args)) await this.driveWriteCommand(args)
    else if (args[0] === "validate") await this.driveValidateCommand(args)
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
   * The emitted scripts for `args`, read off the command's own `--json`
   * response. A scenario that already asked for `--json` has them in
   * `lastResult` already; otherwise this re-invokes with `--json` appended
   * and restores `lastResult` afterwards. Re-invoking is sound precisely
   * because of the property this whole change establishes: every command is
   * now a pure read, so asking twice against an unchanged repo answers
   * identically. Returns `undefined` when the probe itself failed (a refusal
   * the first invocation already reported) — there is nothing to drive then.
   * Exit 3 (SETTLED) is not a failure — its script must still run.
   */
  private async emittedJson(args: string[]): Promise<Record<string, unknown> | undefined> {
    if (args.includes("--json")) return firstJsonObject(this.lastResult.stdout)
    const reported = this.lastResult
    await this.invokeGtd(...args, "--json")
    const probe = this.lastResult
    this.lastResult = reported
    return landExitDrivable(probe.exitCode) ? firstJsonObject(probe.stdout) : undefined
  }

  /**
   * `land`/`--entry`/`abandon`/`restore`: run `required` (the commit, reset,
   * ref update, review-window close/open — everything that decides what lands
   * in git), then `optional` (presentation only, so a non-zero exit there is
   * ignored exactly as the README's minimal driver ignores it). gtd's own
   * plain-text line stays as `lastResult`; only a FAILING required script
   * overrides it, since a scenario asserting "it succeeds" must not pass when
   * the work never landed.
   */
  private async driveWriteCommand(args: string[]): Promise<void> {
    this.lastScriptOutput = ""
    const json = await this.emittedJson(args)
    if (json === undefined) return
    if (!(await this.runRequiredScript(stringField(json, "required")))) return
    const optional = stringField(json, "optional")
    if (optional.length > 0) this.lastScriptOutput += (await this.runEmittedScript(optional)).output
  }

  /** Runs a write command's `required` half; `false` (with `lastResult` already rewritten to say so) when it failed, so the caller skips `optional`. */
  private async runRequiredScript(required: string): Promise<boolean> {
    if (required.length === 0) return true
    const run = await this.runEmittedScript(required)
    this.lastScriptOutput += run.output
    if (run.exitCode === 0) return true
    this.lastResult = {
      exitCode: run.exitCode,
      stdout: this.lastResult.stdout,
      stderr: this.lastResult.stderr + run.output,
    }
    return false
  }

  /**
   * `validate`: gtd prints the format-then-validate script; the verdict lives
   * in that script's exit code, not the command's. Run it and report the
   * verdict the way a driver does (`validateVerdict`). Under `--json` the
   * scenario asked for the engine's raw response (the `script` field itself),
   * so the script still runs — a mode's `format:` half rewrites the file in
   * place, which a scenario may then assert on — but `lastResult` is left as
   * the JSON gtd wrote. An empty `script` ("nothing to validate") leaves gtd's
   * own line alone in both cases.
   */
  private async driveValidateCommand(args: string[]): Promise<void> {
    const json = await this.emittedJson(args)
    if (json === undefined) return
    const script = stringField(json, "script")
    if (script.length === 0) return
    const run = await this.runEmittedScript(script)
    if (args.includes("--json")) return
    this.lastResult = validateVerdict(stringField(json, "file"), run)
  }

  /** Executes one emitted script against whichever repo the tier owns. */
  private async runEmittedScript(script: string): Promise<EmittedRun> {
    return this.repo !== undefined
      ? applyScriptToFake(this.repo, this.scriptedCommands, script)
      : this.runScriptWithBash(script)
  }

  /** Live tier: real `bash`, in the real worktree, with the PATH shim in scope so a script's bare `gtd` resolves to this build. */
  private async runScriptWithBash(script: string): Promise<EmittedRun> {
    try {
      const { stdout, stderr } = await execFile("bash", ["-c", script], {
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
   */
  private spawnEnv(): NodeJS.ProcessEnv {
    const pathEnv = this.pathShimDir
      ? { PATH: `${this.pathShimDir}:${process.env["PATH"] ?? ""}` }
      : {}
    const testCommandEnv =
      this.gtdTestCommandOverride !== undefined
        ? { GTD_TESTCOMMAND: this.gtdTestCommandOverride }
        : {}
    return { ...process.env, ...pathEnv, ...testCommandEnv, NODE_OPTIONS: undefined }
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
   * `@live` only: `gtd land | bash` — the ONE-LINE landing form the whole
   * package exists for, run as a REAL shell pipe (not this world's own
   * `driveWriteCommand` machinery) so `set -o pipefail` propagating gtd's own
   * exit code through the pipe is proven, not assumed. `lastResult.exitCode`
   * is the pipe's own status (`$?` right after it), so `it settles`/
   * `it succeeds` read it exactly like any other invocation.
   */
  async runGtdLandPiped(): Promise<void> {
    const pipeline = `set -o pipefail; ${JSON.stringify(process.execPath)} ${JSON.stringify(GTD_BIN)} land | bash`
    try {
      const { stdout, stderr } = await execFile("bash", ["-c", pipeline], {
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
