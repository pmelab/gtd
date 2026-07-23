import { createRequire } from "node:module"
import { FileSystem } from "@effect/platform"
import { Effect, Either } from "effect"
import { ConfigInit, ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { WorktreeReader } from "./WorktreeReader.js"
import { GitService, type GitOperations } from "./Git.js"
import {
  buildTemplateContext,
  computeProcessRun,
  executeDecision,
  pendingChanges,
  renderFile,
  renderModel,
  renderRest,
  resolveRest,
  resolveVars,
  type ExecutableDecision,
  type ProcessRun,
  type ResolvedRest,
} from "./Edge.js"
import { closeReviewWindow, openReviewWindow } from "./ReviewWindow.js"
import { formatFile } from "./Format.js"
import { startLspServer } from "./Lsp.js"
import { renderMermaid } from "./Mermaid.js"
import {
  matchesPattern,
  parsePattern,
  step,
  type OnEdge,
  type PendingChange,
} from "./PatternMachine.js"
import type { TemplateContext } from "./PatternTemplates.js"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

const HELP_TEXT = `Usage: gtd [command] [options]

Commands:
  step <actor>     Authenticate as <actor>, match the resolved rest's
                   declared patterns against the pending changes, and commit
                   (or squash) the one resulting transition
  next             Print the resolved rest's rendered script/prompt/message
                   (no mutation)
  run              Execute the resolved rest's emitted script, then step its
                   actor (the built-in script driver)
  status           Print the resolved rest's state/actor and which declared
                   pattern (if any) each pending change matches (no mutation)
  mermaid          Print the active workflow's shape as Mermaid
                   stateDiagram-v2 source (no mutation)
  format <file>    Format a markdown file in place
  lsp              Start the LSP server for .gtd/ steering files (stdio)

Options:
  --json           Output structured JSON instead of plain text
  --version, -v    Print version and exit
  --help, -h       Print this help and exit
`

/**
 * Marks an error as already reported inside the `--json` error envelope, so
 * the composition root (main.ts) doesn't emit a second envelope for it.
 * Errors that fail BEFORE `makeProgram` runs — e.g. a config-validation
 * failure at layer construction — carry no mark, and main.ts writes the
 * envelope for them instead.
 */
const ENVELOPED = Symbol.for("gtd/enveloped")
const markEnveloped = (error: Error): Error => Object.assign(error, { [ENVELOPED]: true as const })
export const isEnveloped = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as Record<symbol, unknown>)[ENVELOPED] === true

type ProgramRequirements =
  | GitService
  | FileSystem.FileSystem
  | ConfigService
  | ConfigInit
  | Cwd
  | WorktreeReader
  | EnvVars

/** Non-flag positional arguments past the subcommand name (argv[3..]). */
const commandArgs = (argv: readonly string[]): string[] =>
  argv.slice(3).filter((a) => a.length > 0 && !a.startsWith("--"))

/** Rejects extra positional arguments for a subcommand that takes none (`status`, `run`). */
const rejectExtraArgs = (command: string, argv: readonly string[]): Effect.Effect<void, Error> => {
  const args = commandArgs(argv)
  if (args.length > 0) {
    return Effect.fail(
      new Error(`gtd ${command}: too many arguments — expected none, got: ${args.join(", ")}`),
    )
  }
  return Effect.void
}

/** `gtd format <file>`: reformat a markdown file in place. Rejects `--json` (not a state command). */
const runFormatCommand = (
  argv: readonly string[],
  json: boolean,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    if (json) {
      return yield* Effect.fail(new Error("gtd format does not accept --json"))
    }
    const args = commandArgs(argv)
    if (args.length === 0) {
      return yield* Effect.fail(new Error("gtd format: missing file path argument"))
    }
    if (args.length > 1) {
      return yield* Effect.fail(
        new Error(`gtd format: too many arguments — expected one path, got: ${args.join(", ")}`),
      )
    }
    yield* formatFile(args[0]!)
  })

/**
 * `gtd lsp`: start the LSP server for `.gtd/` steering files over stdio.
 * Rejects `--json` (not a state command) and extra positional arguments
 * (takes none). Dispatched alongside `format` — before the known-subcommand
 * guard, the repo-root guard, and auto-init — since the server needs no
 * git/config/workflow dependency at all (it's keyed on file name, not
 * workflow state; see `src/Lsp.ts`'s module doc).
 */
const runLspCommand = (argv: readonly string[], json: boolean): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (json) {
      return yield* Effect.fail(new Error("gtd lsp does not accept --json"))
    }
    yield* rejectExtraArgs("lsp", argv)
    yield* startLspServer()
  })

/**
 * Resolve HEAD's rest, the current process run, and the template context for
 * rendering that rest's OWN state/actor — the common prefix shared by `gtd
 * next`, `gtd run`, and `gtd status` (each fetches `git` itself first, since
 * `gtd status` also needs it for `pendingChanges`; `stepAsActor`'s squash
 * path renders a DIFFERENT state, so it builds its own context inline
 * instead of sharing this helper).
 */
const resolveRestContext = (
  git: GitOperations,
): Effect.Effect<
  { readonly rest: ResolvedRest; readonly run: ProcessRun; readonly context: TemplateContext },
  Error,
  GitService | ConfigService | WorktreeReader | EnvVars
> =>
  Effect.gen(function* () {
    const config = yield* ConfigService
    const worktree = yield* WorktreeReader
    const envVars = yield* EnvVars
    const rest = yield* resolveRest()
    const run = yield* computeProcessRun(git, rest.def)
    const vars = resolveVars(config.workflowVars, config.rcVars, envVars.all)
    const context = yield* buildTemplateContext(
      git,
      worktree.read,
      rest.state,
      rest.actor,
      run,
      vars,
    )
    return { rest, run, context }
  })

/**
 * Authenticate `invoker` against the resolved rest and perform the one
 * resulting transition (commit or squash), shared by `gtd step` and
 * `gtd run` (which steps the script's own actor after executing it).
 * Refusals fail the Effect with a formatted message; a no-op returns
 * `subject: null` rather than failing (exit zero, per the plan's "clean
 * no-op exits zero").
 */
const stepAsActor = (
  invoker: string,
): Effect.Effect<
  { readonly state: string; readonly subject: string | null },
  Error,
  ProgramRequirements
> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* ConfigService
    const worktree = yield* WorktreeReader
    const envVars = yield* EnvVars
    const rest = yield* resolveRest()
    const run = yield* computeProcessRun(git, rest.def)
    const changes = yield* pendingChanges(git)
    const decision = step(rest.def, rest.state, invoker, { changes, processTrace: run.trace })

    if (decision.kind === "refusal") {
      const message =
        decision.reason === "out-of-turn"
          ? `gtd step ${invoker}: out of turn — "${decision.state}" awaits ${decision.awaits}`
          : `gtd step ${invoker}: no declared pattern matches the pending changes at "${decision.state}" — declared patterns: ${
              decision.patterns.length > 0 ? decision.patterns.join(", ") : "(none)"
            }`
      return yield* Effect.fail(new Error(message))
    }

    if (decision.kind === "noop") {
      return { state: decision.state, subject: null }
    }

    const executable: ExecutableDecision = decision
    const vars = resolveVars(config.workflowVars, config.rcVars, envVars.all)
    const context = yield* buildTemplateContext(
      git,
      worktree.read,
      decision.kind === "squash" ? decision.state : rest.state,
      invoker,
      run,
      vars,
    )
    const outcome = yield* executeDecision(git, run, executable, context)
    return { state: rest.state, subject: outcome.kind === "noop" ? null : outcome.subject }
  })

/** Renders `stepAsActor`'s result the same way for both `gtd step` and `gtd run`. */
const reportStepResult = (
  result: { readonly state: string; readonly subject: string | null },
  json: boolean,
  write: (chunk: string) => void,
): void => {
  if (json) {
    write(JSON.stringify({ state: result.state, subject: result.subject }) + "\n")
  } else {
    write(
      result.subject !== null
        ? `committed: ${result.subject}\n`
        : `nothing to do at "${result.state}"\n`,
    )
  }
}

/** `gtd step <actor>`: authenticate as `<actor>` and perform the one resulting transition. */
const runStepCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    const args = commandArgs(argv)
    if (args.length === 0) {
      return yield* Effect.fail(new Error("gtd step: missing actor argument"))
    }
    if (args.length > 1) {
      return yield* Effect.fail(
        new Error(`gtd step: too many arguments — expected one actor, got: ${args.join(", ")}`),
      )
    }
    const result = yield* stepAsActor(args[0]!)
    reportStepResult(result, json, write)
  })

/** `gtd next [--json]`: pure emitter of the resolved rest's rendered content (no mutation). */
const runNextCommand = (
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const { rest, context } = yield* resolveRestContext(git)
    const rendered = yield* renderRest(rest, context)
    if (json) {
      write(
        JSON.stringify({
          state: rendered.state,
          actor: rendered.actor,
          kind: rendered.kind,
          content: rendered.content,
          ...(rendered.model !== undefined ? { model: rendered.model } : {}),
          ...(rendered.file !== undefined ? { file: rendered.file } : {}),
          ...(rendered.mode !== undefined ? { mode: rendered.mode } : {}),
        }) + "\n",
      )
    } else {
      write(rendered.content.endsWith("\n") ? rendered.content : rendered.content + "\n")
    }
  })

/**
 * `gtd run`: the built-in driver for a `script`-content rest. Renders the
 * resolved rest exactly like `gtd next`, executes its content verbatim via
 * `bash` (the ONLY place gtd spawns a subprocess), then steps that state's
 * own actor to capture the outcome. Refuses when the resolved rest isn't a
 * script (nothing to run).
 */
const runRunCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    yield* rejectExtraArgs("run", argv)
    const git = yield* GitService
    const { rest, context } = yield* resolveRestContext(git)
    const rendered = yield* renderRest(rest, context)
    if (rendered.kind !== "script") {
      return yield* Effect.fail(
        new Error(
          `gtd run: "${rest.state}" awaits a ${rendered.kind} from "${rest.actor}" — nothing scripted to run`,
        ),
      )
    }
    yield* Effect.try({
      try: () => {
        // Sequential, foreground, exit code deliberately ignored: the script
        // encodes the outcome in the tree (e.g. writing a findings file),
        // never in its exit status — the workflow's own `on` patterns decide
        // what that means at capture time (`stepAsActor`, right after).
        const { spawnSync } = _require("node:child_process") as typeof import("node:child_process")
        spawnSync("bash", ["-c", rendered.content], { cwd: process.cwd(), stdio: "inherit" })
      },
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
    const result = yield* stepAsActor(rest.actor)
    reportStepResult(result, json, write)
  })

/** One pending change's status/path plus whichever declared `on` pattern (if any) matches it, for `gtd status`. */
interface StatusChange {
  readonly status: string
  readonly path: string
  readonly pattern: string | null
}

/** Which declared `on` pattern (if any) each pending change matches — the pure computation `gtd status` reports (both plain and `--json`). */
const computeStatusChanges = (
  onEdges: readonly OnEdge[],
  changes: readonly PendingChange[],
): readonly StatusChange[] =>
  changes.map((change) => {
    const matchedRow = onEdges.find(([patternStr]) => {
      const parsed = parsePattern(patternStr)
      return parsed !== undefined && matchesPattern(parsed, [change])
    })
    return { status: change.status, path: change.path, pattern: matchedRow?.[0] ?? null }
  })

/** `gtd status --json`'s emission — `{state, actor, changes, model?, file?, mode?}`. */
const writeStatusJson = (
  write: (chunk: string) => void,
  rest: ResolvedRest,
  statusChanges: readonly StatusChange[],
  model: string | undefined,
  file: string | undefined,
): void => {
  write(
    JSON.stringify({
      state: rest.state,
      actor: rest.actor,
      changes: statusChanges,
      ...(model !== undefined ? { model } : {}),
      ...(file !== undefined ? { file } : {}),
      ...(rest.stateDef.mode !== undefined ? { mode: rest.stateDef.mode } : {}),
    }) + "\n",
  )
}

/** `gtd status`'s plain-text emission — `State:`/`Awaits:`/`Model:`/`File:`/`Mode:`/`Pending:` lines. */
const writeStatusPlain = (
  write: (chunk: string) => void,
  rest: ResolvedRest,
  statusChanges: readonly StatusChange[],
  model: string | undefined,
  file: string | undefined,
): void => {
  const lines = [`State: ${rest.state}`, `Awaits: ${rest.actor}`]
  if (model !== undefined) lines.push(`Model: ${model}`)
  if (file !== undefined) lines.push(`File: ${file}`)
  if (rest.stateDef.mode !== undefined) lines.push(`Mode: ${rest.stateDef.mode}`)
  if (statusChanges.length === 0) {
    lines.push("Pending: (clean)")
  } else {
    lines.push("Pending:")
    for (const c of statusChanges) {
      lines.push(`  ${c.status} ${c.path} -> ${c.pattern ?? "(no match)"}`)
    }
  }
  write(lines.join("\n") + "\n")
}

/** `gtd status`: pure dry-run reporter — the resolved state/actor, and which declared pattern (if any) each pending change matches. */
const runStatusCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    yield* rejectExtraArgs("status", argv)
    const git: GitOperations = yield* GitService
    const { rest, context } = yield* resolveRestContext(git)
    const changes = yield* pendingChanges(git)
    const model = yield* renderModel(rest.stateDef, context)
    const file = yield* renderFile(rest.stateDef, context)
    const statusChanges = computeStatusChanges(rest.stateDef.on ?? [], changes)
    if (json) {
      writeStatusJson(write, rest, statusChanges, model, file)
    } else {
      writeStatusPlain(write, rest, statusChanges, model, file)
    }
  })

/**
 * `gtd mermaid`: pure emitter of the active workflow's SHAPE (not the
 * resolved rest) as Mermaid `stateDiagram-v2` source — see `src/Mermaid.ts`.
 * Needs only `ConfigService` (no HEAD resolution, no rendering), but is
 * dispatched alongside `next`/`status` since it still depends on the active
 * `.gtdrc` — unlike `format`/`lsp`, which need neither git nor config — so it
 * goes through the same repository-root guard and auto-init. Rejects
 * `--json`: there is no structured shape to emit beyond the Mermaid source
 * itself.
 */
const runMermaidCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    if (json) {
      return yield* Effect.fail(new Error("gtd mermaid does not accept --json"))
    }
    yield* rejectExtraArgs("mermaid", argv)
    const config = yield* ConfigService
    write(renderMermaid(config.workflow))
  })

const KNOWN_SUBCOMMANDS = ["step", "next", "run", "status", "mermaid"] as const
type KnownSubcommand = (typeof KNOWN_SUBCOMMANDS)[number]

/**
 * `--version`/`-v` or `--help`/`-h`: short-circuits before any git or state
 * work, so it works outside a repo too. Exported so main.ts can run the same
 * check synchronously BEFORE the Effect runtime builds any layer — layer
 * construction must never observe a version/help invocation.
 */
export const runVersionOrHelp = (
  argv: readonly string[],
  write: (chunk: string) => void,
): boolean => {
  if (argv.includes("--version") || argv.includes("-v")) {
    write(GTD_VERSION + "\n")
    return true
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    write(HELP_TEXT)
    return true
  }
  return false
}

/**
 * Rejects a bare `gtd` invocation or an unrecognized subcommand. Returns the
 * subcommand narrowed to `KnownSubcommand` once past this guard.
 */
const requireKnownSubcommand = (
  sub: string | undefined,
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<KnownSubcommand, Error> => {
  if (sub === undefined) {
    if (!json) write(HELP_TEXT)
    return Effect.fail(new Error("gtd: missing command — see usage above (`gtd --help`)"))
  }
  if (!(KNOWN_SUBCOMMANDS as readonly string[]).includes(sub)) {
    return Effect.fail(new Error(`unknown command '${sub}'`))
  }
  return Effect.succeed(sub as KnownSubcommand)
}

/**
 * Everything gtd derives — the workflow definition, pending changes, process
 * history — is resolved against the process cwd, so running from anywhere
 * but the repository root would silently mis-derive state. Refuses with a
 * clear error instead. (Fails fast outside a repository too:
 * `--show-toplevel` errors there.) Real paths are compared so symlinked cwds
 * (e.g. macOS /tmp → /private/tmp) match.
 */
const assertRunningFromRepoRoot = (
  git: GitOperations,
  fs: FileSystem.FileSystem,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const topLevel = yield* git.topLevel()
    const topReal = yield* fs.realPath(topLevel)
    const cwdReal = yield* fs.realPath(process.cwd())
    if (topReal !== cwdReal) {
      return yield* Effect.fail(
        new Error(
          `gtd must be run from the repository root (${topLevel}); ` +
            `the current directory is ${process.cwd()}`,
        ),
      )
    }
  })

/** Dispatches to the named `run*Command` handler for every known subcommand. */
const dispatchKnownSubcommand = (
  sub: KnownSubcommand,
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> => {
  switch (sub) {
    case "step":
      return runStepCommand(argv, json, write)
    case "next":
      return runNextCommand(json, write)
    case "run":
      return runRunCommand(argv, json, write)
    case "status":
      return runStatusCommand(argv, json, write)
    case "mermaid":
      return runMermaidCommand(argv, json, write)
  }
}

/**
 * Options for the exported `makeProgram` factory.
 * Defaults to `process.argv` and `process.stdout.write` so production wiring is
 * unchanged.
 */
export interface RunOptions {
  /** argv array (e.g. `["node", "gtd.js", "format", "file.md"]`). Defaults to `process.argv`. */
  argv?: string[]
  /** Sink for stdout output. Defaults to `process.stdout.write.bind(process.stdout)`. */
  write?: (chunk: string) => void
}

/**
 * Factory that returns the gtd driver Effect with the given I/O options.
 *
 * The returned Effect requires `GitService | FileSystem.FileSystem |
 * ConfigService | ConfigInit | Cwd | WorktreeReader`. Production code calls
 * this with no arguments; the test world supplies an in-memory layer set and
 * captures stdout via the `write` callback.
 *
 * v3 command surface: `step <actor>` / `next` / `run` / `status` (see
 * `src/Edge.ts` and `docs/design/pattern-machine-plan.md` §3), plus `format
 * <file>` (unchanged from v1/v2). Bare `gtd` or an unknown subcommand is a
 * usage error. Shared setup (argv parsing, the repo-root guard) lives here;
 * each subcommand's own logic is a named `run*Command` function above.
 */
export function makeProgram(
  opts: RunOptions = {},
): Effect.Effect<void, Error, ProgramRequirements> {
  const argv = opts.argv ?? process.argv
  const write = opts.write ?? ((chunk: string) => process.stdout.write(chunk))
  const json = argv.includes("--json")
  const positional = argv.slice(2).find((a) => !a.startsWith("--"))

  return Effect.gen(function* () {
    if (runVersionOrHelp(argv, write)) return

    // Reject unknown `--` options up front: a typo like `--jsn` must not
    // silently degrade to plain-text mode. `--json` is the only long option;
    // `--version`/`--help` (and their short forms) short-circuited above.
    const unknownOption = argv.slice(2).find((a) => a.startsWith("--") && a !== "--json")
    if (unknownOption !== undefined) {
      return yield* Effect.fail(
        new Error(`gtd: unknown option '${unknownOption}' — see \`gtd --help\``),
      )
    }

    if (positional === "format") {
      return yield* runFormatCommand(argv, json)
    }

    if (positional === "lsp") {
      return yield* runLspCommand(argv, json)
    }

    const sub = yield* requireKnownSubcommand(positional, json, write)

    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    yield* assertRunningFromRepoRoot(git, fs)
    // Restore the real HEAD before anything reads or mutates workflow state:
    // while a review checkout window is open (see src/ReviewWindow.ts), HEAD is
    // rewound to the review base, so the pure machine would otherwise resolve
    // against the wrong commit. Keyed on the ref alone — a no-op when no window
    // is open.
    yield* closeReviewWindow
    // Auto-init runs here and ONLY here: past the version/help short-circuit,
    // the format branch, the known-subcommand guard, and the repo-root guard —
    // a refused or rejected invocation must never mutate the repository.
    yield* (yield* ConfigInit).ensure

    // Re-arm the window after the subcommand — on success AND on refusal/error,
    // and after read-only commands too (every command opts into window
    // management), so the editor's diff view stays consistent no matter which
    // command the loop last ran. The subcommand's own error takes priority; a
    // re-arm failure only surfaces when the subcommand itself succeeded.
    const outcome = yield* Effect.either(dispatchKnownSubcommand(sub, argv, json, write))
    const rearm = yield* Effect.either(openReviewWindow)
    if (Either.isLeft(outcome)) return yield* Effect.fail(outcome.left)
    if (Either.isLeft(rearm)) return yield* Effect.fail(rearm.left)
  }).pipe(
    json
      ? Effect.catchAll((error) =>
          Effect.sync(() =>
            write(JSON.stringify({ state: "error", prompt: error.message }) + "\n"),
          ).pipe(Effect.zipRight(Effect.fail(markEnveloped(error)))),
        )
      : (x) => x,
  )
}
