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
import { constants as osConstants, networkInterfaces, tmpdir } from "node:os"
import { join, relative, resolve, sep } from "node:path"
import { PassThrough } from "node:stream"
import { setTimeout as delay } from "node:timers/promises"
import { runCli } from "../../../src/cli/index.js"
import { runJudge } from "../../../src/judges/index.js"
import { inMemoryJudgeIo, type ScriptedClaude } from "./judge-io.js"
import { EXIT_OK } from "../../../src/wire/index.js"
import {
  makeCapturingCliIo,
  type ScriptedCommand,
  InMemRepo,
  applyEmittedScript,
} from "../../../src/testkit/index.js"
import {
  runUiCommand,
  UiUsageError,
  type AppRouter,
  type DiffResult,
  type ServeRecord,
  type UiConfig,
  type UiHandler,
} from "../../../src/ui/index.js"
import { GtdError, GtdUsageError } from "../../../src/platform/index.js"
import { NodeContext } from "@effect/platform-node"
import { inMemoryUiHost, inMemoryUiLayers, type FakeTailnet } from "./ui-host.js"
import type { SteeringAnchor, SteeringView } from "../../../src/steering/index.js"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..")
// Exported so hooks.ts's PATH shim execs this SAME bundle, never a globally-installed gtd.
export const GTD_BIN = join(PROJECT_ROOT, "dist/gtd.bundle.mjs")

// The gate shim's marker poll: how often, and how long before giving up.
const GIT_GATE_POLL_INTERVAL_MS = 10
const GIT_GATE_TIMEOUT_MS = 10_000

// How long a spawned `gtd ui`'s poll loop waits for its printed bound/serve
// URL before giving up — a real spawn shells out further (a self-signed cert
// via real openssl, or a real `tailscale` probe) on top of the ordinary
// bind, and this suite's own `run-in-pty.py` documents the same fact for a
// process this heavy CI/dev load can starve of CPU for seconds at a time.
// 5 real seconds (the previous 100 × 50ms budget) was measured too tight
// under this suite's own full `npm test` (`test:unit` + both `test:e2e:*`
// tasks all racing via turbo) — not a functional bug in `gtd ui`, every one
// of these scenarios passes in isolation.
const UI_BOUND_URL_POLL_ATTEMPTS = 600
const UI_BOUND_URL_POLL_INTERVAL_MS = 50

export type Tier = "live" | "inmem"

/**
 * The `done` mutation's own note-carrying request (package 04 Task 1's
 * nested `{ note: {...} }` shape) — every real `spawnGtdUi*AndHandOff`
 * helper below builds the exact same shape off its own `filePath`/`headSha`/
 * `content`/`mode`/`text`, at a fixed paragraph-0 anchor (the phone's own
 * "Save & Done" always attaches to the anchor the human was looking at,
 * which every one of these scenarios sets up as paragraph 0).
 */
/** Where `gtd ui` listens: a direct bind, a serve port, or the default serve walk. */
type UiTarget = "direct" | "default" | number

interface UiSession {
  readonly client: ReturnType<typeof import("@trpc/client").createTRPCClient<AppRouter>>
  readonly headSha: () => string
  /** `path`'s content, empty when absent. */
  readonly read: (path: string) => string
  /** A plain GET of the served page; its status. */
  readonly reload: () => Promise<number>
  /** Settles once `gtd ui` has exited. */
  readonly finished: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  /** Ends a session that does not end itself. */
  readonly stop: () => Promise<void>
}

const UI_ARGS = (target: UiTarget): string[] =>
  target === "direct"
    ? ["--host", "127.0.0.1", "--self-signed", "--port", "0"]
    : target === "default"
      ? []
      : ["--port", String(target)]

/** A `fetch` answered by `handler` in-process; its after-response callbacks run once the response is out. */
const bridgeFetch =
  (handler: UiHandler): typeof globalThis.fetch =>
  async (input, init) => {
    const after: Array<() => void> = []
    const response = await handler(new Request(input, init), (callback) => after.push(callback))
    setImmediate(() => after.forEach((callback) => callback()))
    return response
  }

type ToolUi = NonNullable<NonNullable<Parameters<typeof makeCapturingCliIo>[2]>["ui"]>

const doneNoteRequest = (
  filePath: string,
  headSha: string,
  contentHash: string,
  mode: string | undefined,
  text: string,
  anchor: SteeringAnchor = { kind: "paragraph", line: 0 },
) => ({
  note: {
    filePath,
    expectedHeadSha: headSha,
    expectedContentHash: contentHash,
    mode,
    anchor,
    text,
  },
})

/**
 * Commands that print a `required`/`optional` script for a driver to run
 * instead of performing their git effect directly (`land`, `abandon`,
 * `restore`, bare `gtd --workflow <name>`, `gtd door <name>`). Everything else is a read command
 * with nothing to drive.
 */
const WRITE_COMMAND_TOKENS: ReadonlySet<string> = new Set([
  "land",
  "abandon",
  "restore",
  "--workflow",
  "door",
])

/**
 * `--json` (bare or `--json=<path>`) prints a structured document, not the
 * runnable script itself — never something `driveWriteCommand` should feed
 * to `sh` as-is.
 */
const requestsStructuredOutput = (args: readonly string[]): boolean =>
  args.some((a) => a === "--json" || a.startsWith("--json="))

/** `--workflow` takes both spellings, `--workflow <name>` and `--workflow=<name>`. */
const isWriteCommand = (args: readonly string[]): boolean => {
  if (requestsStructuredOutput(args)) return false
  const first = args[0] ?? ""
  return WRITE_COMMAND_TOKENS.has(first) || first.startsWith("--workflow=")
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

/** `gtd validate`'s own "nothing to run" plain-text line — `Program.ts`'s `runValidateCommand`. */
const NOTHING_TO_VALIDATE_RE = /^nothing to validate at "/

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
        `Teach src/testkit/EmittedScriptRecognizer.ts about it.\nScript:\n${script}`,
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
  tailnet: FakeTailnet = { mappings: new Map(), failPublish: false }
  private uiScratch = new Map<string, string>()
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
  /** Package 01 Task 10's own stale-write proof: the typed refusal `spawnGtdUiAndSetValueWithStaleHash` reads off a real rejected `setValue` mutation, or `undefined` if the write unexpectedly succeeded. */
  lastWriteRefusal: { readonly reason: string; readonly moved?: string } | undefined = undefined
  /** Package 01 Task 10's own `ui.format` proof: the first write's own post-format `contentHash`, and whether a second write issued against it succeeded — `spawnGtdUiAndWriteTwiceReusingHash`'s result. */
  formatWriteResult: { readonly firstContentHash: string; readonly secondOk: boolean } | undefined =
    undefined
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
  private spawnEnv(): NodeJS.ProcessEnv {
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

  /**
   * The `@inmem` tier's own stdin-piping counterpart: `runCli` runs IN this
   * test process (no subprocess to spawn), so piping means swapping this
   * process's own `process.stdin` for a `PassThrough` pre-loaded with
   * `stdin` — the same technique `src/cli/Program.test.ts`'s `gtd lsp` test and
   * `src/lsp/Lsp.test.ts` use — restored in a `finally` so a leftover stub can
   * never leak into a later scenario.
   */
  private async runGtdInMemWithStdin(stdin: string, ...args: string[]): Promise<void> {
    await this.withStdin(stdin, () => this.runGtdInMem(...args))
  }

  private async withStdin<T>(stdin: string, run: () => Promise<T>): Promise<T> {
    const saved = Object.getOwnPropertyDescriptor(process, "stdin")
    const fake = new PassThrough()
    Object.defineProperty(process, "stdin", { value: fake, configurable: true })
    fake.end(stdin)
    try {
      return await run()
    } finally {
      if (saved) Object.defineProperty(process, "stdin", saved)
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
   * makes a fixed delay flaky), then dies exactly
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
      [this.gtdBin, "ui", "--host", "127.0.0.1", "--self-signed", "--port", "0"],
      { cwd: this.repoDir, env: this.spawnEnv(), stdio: ["ignore", "pipe", "pipe"] },
    )
    let stdout = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    // Without stderr in the failure message, a `gtd ui` that exits on a config
    // error is indistinguishable from one that merely bound slowly.
    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("exit", (code, sig) => resolve({ code, signal: sig }))
      },
    )
    await new Promise<void>((resolve) => child.once("spawn", () => resolve()))
    for (let i = 0; i < UI_BOUND_URL_POLL_ATTEMPTS && !stdout.includes("https://"); i += 1) {
      await delay(UI_BOUND_URL_POLL_INTERVAL_MS)
    }
    assert.ok(stdout.includes("https://"), `gtd ui never printed its bound URL: ${stdout}${stderr}`)
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
    const child = spawn(process.execPath, [this.gtdBin, "ui", "--port", String(servePort)], {
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
    for (let i = 0; i < UI_BOUND_URL_POLL_ATTEMPTS && !stdout.includes("https://"); i += 1) {
      await delay(UI_BOUND_URL_POLL_INTERVAL_MS)
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
   * A running `gtd ui` and a tRPC client talking to it. Live: a spawned
   * process, over TLS on a direct bind or plain http on a serve target. In
   * memory: the same server in-process, the client's `fetch` handed straight
   * to its handler.
   */
  private async openUi(target: UiTarget): Promise<UiSession> {
    const { createTRPCClient, httpBatchLink } = await import("@trpc/client")
    const connect = (url: string, fetch: typeof globalThis.fetch = globalThis.fetch) =>
      createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${url}trpc`, fetch: fetch as never })],
      })
    if (this.repo !== undefined) return this.openUiInMem(target, connect)
    const previousTlsReject = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    const spawned = await this.spawnUiFor(target)
    let base = spawned.boundUrl
    if (spawned.servePort !== undefined) {
      const { readServeRecord } = await import("../../../src/ui/index.js")
      const servePort = spawned.servePort
      const record = await this.withServeHome(() => readServeRecord(servePort))
      assert.ok(record !== undefined, `no ownership record for serve port ${servePort}`)
      base = `http://127.0.0.1:${record.targetPort}/`
      this.lastServePort = servePort
    }
    const finished = spawned.exited.finally(() => this.restoreTlsReject(previousTlsReject))
    return {
      client: connect(base),
      headSha: () => execSync("git rev-parse HEAD", { cwd: this.repoDir, encoding: "utf8" }).trim(),
      read: (path) => this.readRepoFile(path),
      reload: async () => (await fetch(base)).status,
      finished,
      stop: async () => {
        spawned.child.kill("SIGTERM")
        await finished
      },
    }
  }

  private async spawnUiFor(target: UiTarget): Promise<{
    readonly child: ReturnType<typeof spawn>
    readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
    readonly boundUrl: string
    readonly servePort?: number
  }> {
    if (target === "direct") return this.spawnBoundGtdUi()
    if (target === "default")
      return { ...(await this.spawnBoundGtdUiServeDefaultPort()), boundUrl: "" }
    return { ...(await this.spawnBoundGtdUiServe(target)), boundUrl: "", servePort: target }
  }

  private async openUiInMem(
    target: UiTarget,
    connect: (url: string, fetch: typeof globalThis.fetch) => UiSession["client"],
  ): Promise<UiSession> {
    const abort = new AbortController()
    const run = this.gtdInMemUntil(abort.signal, "ui", ...UI_ARGS(target))
    const handler = await this.boundUiHandler(run)
    if (target !== "direct") {
      this.lastServePort = target === "default" ? [...this.serveRecords.keys()][0] : target
    }
    const fetchInMem = bridgeFetch(handler)
    return {
      client: connect("http://inmem/", fetchInMem),
      headSha: () => this.repo!.resolveRef("HEAD")!,
      read: (path) => this.readRepoFile(path),
      reload: async () => (await fetchInMem("http://inmem/")).status,
      finished: run.then((result) => ({ code: result.exitCode, signal: null })),
      stop: async () => {
        abort.abort()
        await run
      },
    }
  }

  /** The handler of the `gtd ui` `run` started, once it binds — or its refusal. */
  private async boundUiHandler(run: Promise<{ readonly stderr: string }>): Promise<UiHandler> {
    this.uiHandler = undefined
    const refused = run.then((result) => result.stderr)
    for (let i = 0; i < 500 && this.uiHandler === undefined; i += 1) {
      const stderr = await Promise.race([refused, delay(2).then(() => undefined)])
      if (stderr !== undefined) assert.fail(`gtd ui never bound: ${stderr}`)
    }
    assert.ok(this.uiHandler !== undefined, "gtd ui never bound")
    return this.uiHandler
  }

  /** Ends a session on its own `done`, recording how it exited. */
  private async handOffThrough(
    session: UiSession,
    done: (client: UiSession["client"]) => Promise<unknown>,
  ): Promise<void> {
    await done(session.client)
    await this.recordSpawnedExit(session.finished)
  }

  private async noteRequest(
    session: UiSession,
    filePath: string,
    mode: string | undefined,
    text: string,
    anchor?: SteeringAnchor,
  ) {
    const { contentHashOf } = await import("../../../src/ui/index.js")
    return doneNoteRequest(
      filePath,
      session.headSha(),
      contentHashOf(session.read(filePath)),
      mode,
      text,
      anchor,
    )
  }

  /** Hands off a note through `gtd ui` on `servePort`'s tailscale serve front door. */
  async spawnGtdUiServeAndHandOff(
    servePort: number,
    filePath: string,
    mode: string,
    text: string,
  ): Promise<void> {
    const session = await this.openUi(servePort)
    const note = await this.noteRequest(session, filePath, mode, text)
    await this.handOffThrough(session, (client) => client.done.mutate(note))
  }

  /** Arms the fake `tailscale` to fail every later `serve --bg`. */
  armFailPublish(): void {
    if (this.repo !== undefined) {
      this.tailnet.failPublish = true
      return
    }
    assert.ok(this.tailscaleStateDir !== undefined, "no fake tailscale state dir on this world")
    writeFileSync(join(this.tailscaleStateDir, "fail-publish"), "")
  }

  /** A mapping on `port` with no ownership record: what another `gtd ui` publishing first looks like. */
  seedForeignServeMapping(port: number): void {
    if (this.repo !== undefined) {
      this.tailnet.mappings.set(port, "http://127.0.0.1:9999")
      return
    }
    assert.ok(this.tailscaleStateDir !== undefined, "no fake tailscale state dir on this world")
    writeFileSync(join(this.tailscaleStateDir, `${port}.mapping`), "http://127.0.0.1:9999")
  }

  /** Whether the fake `tailscale` still maps `port`. */
  serveMappingExists(port: number): boolean {
    if (this.repo !== undefined) return this.tailnet.mappings.has(port)
    return existsSync(join(this.tailscaleStateDir!, `${port}.mapping`))
  }

  /** The ownership record `gtd ui` keeps for `port`. */
  async serveRecordOf(port: number): Promise<ServeRecord | undefined> {
    if (this.repo !== undefined) return this.serveRecords.get(port)
    const { readServeRecord } = await import("../../../src/ui/index.js")
    return this.withServeHome(() => readServeRecord(port))
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
    const child = spawn(process.execPath, [this.gtdBin, "ui"], {
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
    for (let i = 0; i < UI_BOUND_URL_POLL_ATTEMPTS && !stdout.includes("https://"); i += 1) {
      await delay(UI_BOUND_URL_POLL_INTERVAL_MS)
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

  /** The default candidate walk: no `--port`, so `gtd ui` picks the serve port itself. */
  async spawnGtdUiServeAndHandOffDefaultPort(
    filePath: string,
    mode: string,
    text: string,
  ): Promise<void> {
    const session = await this.openUi("default")
    const note = await this.noteRequest(session, filePath, mode, text)
    await this.handOffThrough(session, (client) => client.done.mutate(note))
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

    // This machine's own interfaces: where the spawned server bound to.
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

  /** A `done` carrying a note, then `gtd ui` exiting on its own. */
  async spawnGtdUiAndHandOff(
    filePath: string,
    mode: string | undefined,
    text: string,
    anchor?: SteeringAnchor,
  ): Promise<void> {
    const session = await this.openUi("direct")
    const note = await this.noteRequest(session, filePath, mode, text, anchor)
    await this.handOffThrough(session, (client) => client.done.mutate(note))
  }

  /** A `done` with no note — the Done control. */
  async spawnGtdUiAndHandOffNoNote(): Promise<void> {
    const session = await this.openUi("direct")
    await this.handOffThrough(session, (client) => client.done.mutate({}))
  }

  /** A `setValue` write against the file's real token; `setValue` never ends the turn. */
  async spawnGtdUiAndSetValue(
    filePath: string,
    mode: string | undefined,
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<void> {
    const session = await this.openUi("direct")
    const { contentHashOf } = await import("../../../src/ui/index.js")
    try {
      await session.client.setValue.mutate({
        filePath,
        expectedHeadSha: session.headSha(),
        expectedContentHash: contentHashOf(session.read(filePath)),
        mode,
        anchor,
        ...opts,
      })
    } finally {
      await session.stop()
    }
  }

  /** The idle round trip: a write that creates `filePath`, then a `done` with no note. */
  async spawnGtdUiAndSketchThenHandOff(filePath: string, text: string): Promise<void> {
    const session = await this.openUi("direct")
    const { contentHashOf } = await import("../../../src/ui/index.js")
    await this.handOffThrough(session, async (client) => {
      await client.setValue.mutate({
        filePath,
        expectedHeadSha: session.headSha(),
        expectedContentHash: contentHashOf(session.read(filePath)),
        mode: undefined,
        anchor: { kind: "paragraph", line: 0 },
        text,
      })
      await client.done.mutate({})
    })
  }

  /** The `readSteeringFile` view a phone's first load renders, kept on `lastSteeringView`. */
  async spawnGtdUiAndReadView(filePath: string, mode: string | undefined): Promise<void> {
    const session = await this.openUi("direct")
    try {
      const result = await session.client.readSteeringFile.query({ filePath, mode })
      assert.ok(result.ok, `expected readSteeringFile to succeed, got: ${JSON.stringify(result)}`)
      this.lastSteeringView = result.view
    } finally {
      await session.stop()
    }
  }

  /** The `diff` a review hunk's screen fetches, kept on `lastDiffResult`. */
  async spawnGtdUiAndResolveDiff(
    path: string,
    line: number | undefined,
    endLine: number | undefined,
  ): Promise<void> {
    const session = await this.openUi("direct")
    try {
      this.lastDiffResult = await session.client.diff.query({
        path,
        ...(line !== undefined ? { line } : {}),
        ...(endLine !== undefined ? { endLine } : {}),
      })
    } finally {
      await session.stop()
    }
  }

  /** A `setValue` whose content-hash token can never match, keeping the refusal on `lastWriteRefusal`. */
  async spawnGtdUiAndSetValueWithStaleHash(
    filePath: string,
    mode: string | undefined,
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<void> {
    await this.setValueExpectingRefusal(filePath, mode, anchor, opts)
  }

  /** A `setValue` against a path that is a directory — refused before the token is ever compared. */
  async spawnGtdUiAndSetValueAgainstUnreadableFile(
    filePath: string,
    mode: string | undefined,
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<void> {
    await this.setValueExpectingRefusal(filePath, mode, anchor, opts)
  }

  private async setValueExpectingRefusal(
    filePath: string,
    mode: string | undefined,
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<void> {
    const session = await this.openUi("direct")
    const { TRPCClientError } = await import("@trpc/client")
    try {
      await session.client.setValue.mutate({
        filePath,
        expectedHeadSha: session.headSha(),
        // Never the hash of anything on disk.
        expectedContentHash: "0".repeat(64),
        mode,
        anchor,
        ...opts,
      })
      this.lastWriteRefusal = undefined
    } catch (error) {
      assert.ok(
        error instanceof TRPCClientError,
        `expected a TRPCClientError, got: ${String(error)}`,
      )
      const data = (error as InstanceType<typeof TRPCClientError>).data as
        | { writeRefusal?: { reason: string; moved?: string } }
        | undefined
      assert.ok(data?.writeRefusal, "expected a writeRefusal on the rejected mutation's data")
      this.lastWriteRefusal = data!.writeRefusal
    } finally {
      await session.stop()
    }
  }

  /** Two writes, the second reusing the first's returned hash — `ui.format`'s rewrite must already be in it. */
  async spawnGtdUiAndWriteTwiceReusingHash(
    filePath: string,
    mode: string | undefined,
    anchor: SteeringAnchor,
    firstText: string,
    secondText: string,
  ): Promise<void> {
    const session = await this.openUi("direct")
    const { contentHashOf } = await import("../../../src/ui/index.js")
    try {
      const headSha = session.headSha()
      const first = await session.client.setValue.mutate({
        filePath,
        expectedHeadSha: headSha,
        expectedContentHash: contentHashOf(session.read(filePath)),
        mode,
        anchor,
        text: firstText,
      })
      let secondOk = true
      try {
        await session.client.setValue.mutate({
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
      await session.stop()
    }
  }

  /** A page reload, then a `done`: the reload must not end the server. */
  async spawnGtdUiReloadThenHandOff(filePath: string, mode: string, text: string): Promise<void> {
    const session = await this.openUi("direct")
    assert.strictEqual(await session.reload(), 200, "the reload must still be served")
    const note = await this.noteRequest(session, filePath, mode, text)
    await this.handOffThrough(session, (client) => client.done.mutate(note))
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
    return this.withStdin(stdin, () => this.gtdInMem(...args))
  }

  /** One in-process gtd run against the in-memory repository, leaving `lastResult` alone. */
  async gtdInMem(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.gtdInMemUntil(undefined, ...args)
  }

  /** `gtd ui` in memory: the real server, on the in-memory host, shell and listener. */
  private uiTool(): ToolUi {
    return (request, out) => {
      const host = inMemoryUiHost(request.root, this.repo!, {
        gtd: (...args) => this.gtdInMem(...args),
        sh: (script) => this.runEmittedScript(script),
        serveRecords: this.serveRecords,
        scratch: this.uiScratch,
      })
      const layers = inMemoryUiLayers(host, this.tailnet, this.uiScratch, (handler) => {
        this.uiHandler = handler
      })
      return runUiCommand(
        request.flags,
        request.config as UiConfig | undefined,
        out,
        request.root,
      ).pipe(
        Effect.provide(layers),
        Effect.provide(NodeContext.layer),
        Effect.mapError((error) =>
          error instanceof UiUsageError
            ? new GtdUsageError(error.message, error.detail)
            : new GtdError(error.message, error.detail),
        ),
      )
    }
  }

  /** One in-process gtd run, interrupted when `signal` aborts. */
  private async gtdInMemUntil(
    signal: AbortSignal | undefined,
    ...args: string[]
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    // `gtd judge run` is the one tool command `@inmem` scenarios run for real.
    const judgeIo = inMemoryJudgeIo(this.repoDir, this.repo!, {
      userFiles: this.userFiles,
      fetch: this.judgeFetch,
      claude: this.scriptedClaude,
      calls: this.claudeCalls,
    })
    const { io, result } = makeCapturingCliIo(this.repo!, this.envVars, {
      judge: (request) => runJudge({ ...request, io: judgeIo }),
      ui: this.uiTool(),
    })
    await Effect.runPromise(runCli(["node", "gtd.js", ...args], io), { signal }).catch(
      (error: unknown) => {
        if (signal?.aborted !== true) throw error
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
