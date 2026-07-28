import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { FileSystem } from "@effect/platform"
import { Effect, Either } from "effect"
import { configPresentAt, ConfigService } from "./Config.js"
import { PROMPTS_DIR, renderInitScaffold } from "./workflows/templates.js"
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
  renderMemory,
  renderModel,
  renderRest,
  resolveRest,
  resolveVars,
  toTemplateEdges,
  UNATTRIBUTED_MODEL,
  withReviewBaseTrailer,
  type ExecutableDecision,
  type ModelCost,
  type ProcessRun,
  type RenderedRest,
  type ResolvedRest,
} from "./Edge.js"
import { closeReviewWindow, openReviewWindow, reviewBaseHash } from "./ReviewWindow.js"
import { startLspServer } from "./Lsp.js"
import { renderMermaid } from "./Mermaid.js"
import {
  formatAndValidateSteeringFile,
  resolveSteeringMode,
  unknownModeMessage,
} from "./SteeringMode.js"
import {
  initialStateOf,
  isReviewWindowState,
  matchesPattern,
  parsePattern,
  reviewEntryStateOf,
  stateSubject,
  step,
  type OnEdge,
  type PendingChange,
  type StepRefusal,
} from "./PatternMachine.js"
import type { TemplateContext } from "./PatternTemplates.js"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

const HELP_TEXT = `Usage: gtd [command] [options]

Commands:
  init             Scaffold a .gtdrc.json for this repo with the bundled
                   unified workflow; its agent prompts are written as editable
                   Markdown under gtd-prompts/ and referenced from the config.
                   Takes no argument. Run once per repo; refuses if a gtd
                   config already exists. Leaves the files uncommitted for you
                   to review and commit
  step <actor>     Authenticate as <actor>, match the resolved rest's
                   declared patterns against the pending changes, and commit
                   (or squash) the one resulting transition. Pass
                   --cost=<n> (optionally --model=<name>) to record the
                   just-finished invocation's token cost and model on the
                   turn commit (summed into it.processCost/processCostByModel)
  review <commitish>
                   Start a NEW review process at the workflow's declared
                   review-entry state (reviewEntry: true), reviewing
                   <commitish>..HEAD — e.g. a colleague's PR branch. Requires
                   a clean tree resting at the workflow's initial state
  next             Print the resolved rest's rendered script/prompt/message
                   (no mutation)
  status           Print the resolved rest's state/actor and which declared
                   pattern (if any) each pending change matches (no mutation)
  validate         Format and validate the steering file the resolved rest
                   declares, with its mode's commands (its file:/mode:);
                   exits non-zero with the findings when it is invalid
  mermaid          Print the active workflow's shape as Mermaid
                   stateDiagram-v2 source (no mutation)
  lsp              Start the LSP server for .gtd/ steering files (stdio)
  version          Print version and exit
  help             Print this help and exit

Options:
  --json           Output structured JSON instead of plain text
  --cost=<n>       (gtd step only) record the invocation's token cost
  --model=<name>   (gtd step only, with --cost) tag that cost's model
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

/**
 * The stderr line for a CLI error (see `main.ts`): a `gtd: ` prefix UNLESS the
 * message already carries one. Most gtd errors are authored with a
 * `gtd:`/`gtd <cmd>:` prefix of their own (e.g. `gtd init: …`,
 * `gtd: no workflow configured …`), so a blind prepend produced a doubled
 * `gtd: gtd: …`.
 */
export const cliErrorLine = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return /^gtd[: ]/.test(message) ? message : `gtd: ${message}`
}

type ProgramRequirements =
  | GitService
  | FileSystem.FileSystem
  | ConfigService
  | Cwd
  | WorktreeReader
  | EnvVars

/** Non-flag positional arguments past the subcommand name (argv[3..]). */
const commandArgs = (argv: readonly string[]): string[] =>
  argv.slice(3).filter((a) => a.length > 0 && !a.startsWith("--"))

const COST_FLAG = "--cost="

/**
 * Parse the optional `--cost=<n>` flag (only `gtd step` accepts it — see
 * `makeProgram`). `<n>` is the token cost of the invocation that produced the
 * pending changes, recorded as a `Gtd-Cost:` trailer on the turn commit. Must
 * be a non-negative finite number; a bare `--cost` (no `=`) or a non-numeric/
 * negative value is a usage error. Returns `undefined` when the flag is absent.
 */
const parseCostFlag = (argv: readonly string[]): Effect.Effect<number | undefined, Error> => {
  if (argv.slice(2).includes("--cost")) {
    return Effect.fail(new Error("gtd: --cost requires a value — use --cost=<number>"))
  }
  const flag = argv.slice(2).find((a) => a.startsWith(COST_FLAG))
  if (flag === undefined) return Effect.succeed(undefined)
  const raw = flag.slice(COST_FLAG.length)
  const n = Number(raw)
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0) {
    return Effect.fail(new Error(`gtd: --cost must be a non-negative number — got "${raw}"`))
  }
  return Effect.succeed(n)
}

const MODEL_FLAG = "--model="

/**
 * Parse the optional `--model=<name>` flag (only `gtd step`, and only
 * alongside `--cost` — see `makeProgram`). `<name>` tags the recorded cost
 * with the model the invocation ran on, appended to the `Gtd-Cost:` trailer
 * and grouped in `it.processCostByModel`. Must be non-empty and single-line
 * (it rides on one trailer line); a bare `--model` (no `=`) or an empty/
 * multiline value is a usage error. Returns `undefined` when the flag is absent.
 */
const parseModelFlag = (argv: readonly string[]): Effect.Effect<string | undefined, Error> => {
  if (argv.slice(2).includes("--model")) {
    return Effect.fail(new Error("gtd: --model requires a value — use --model=<name>"))
  }
  const flag = argv.slice(2).find((a) => a.startsWith(MODEL_FLAG))
  if (flag === undefined) return Effect.succeed(undefined)
  const raw = flag.slice(MODEL_FLAG.length)
  if (raw.trim() === "" || /[\r\n]/.test(raw)) {
    return Effect.fail(new Error("gtd: --model must be a non-empty, single-line value"))
  }
  return Effect.succeed(raw)
}

/**
 * Parse and validate the `--cost`/`--model` step flags together. Both are
 * orthogonal to `--json` but only meaningful to `gtd step` — rejected on any
 * other command rather than silently ignored (same discipline as `--json` on
 * `next`) — and `--model` requires `--cost` (a model tag with no token count
 * records nothing to sum).
 */
const parseStepFlags = (
  argv: readonly string[],
  positional: string | undefined,
): Effect.Effect<
  { readonly cost: number | undefined; readonly model: string | undefined },
  Error
> =>
  Effect.gen(function* () {
    const cost = yield* parseCostFlag(argv)
    const model = yield* parseModelFlag(argv)
    if (cost !== undefined && positional !== "step") {
      return yield* Effect.fail(new Error("gtd: --cost is only valid for `gtd step`"))
    }
    if (model !== undefined && positional !== "step") {
      return yield* Effect.fail(new Error("gtd: --model is only valid for `gtd step`"))
    }
    if (model !== undefined && cost === undefined) {
      return yield* Effect.fail(
        new Error(
          "gtd: --model requires --cost — it tags the recorded cost with the model that ran",
        ),
      )
    }
    return { cost, model }
  })

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

/**
 * `gtd lsp`: start the LSP server for `.gtd/` steering files over stdio.
 * Rejects `--json` (not a state command) and extra positional arguments
 * (takes none). Dispatched BEFORE the known-subcommand guard and the repo-root
 * guard — since the server needs no git/config/workflow dependency at all
 * (it's keyed on file name, not workflow state; see `src/Lsp.ts`'s module doc).
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
 * `gtd init`: scaffold a `.gtdrc.json` carrying the bundled unified workflow
 * template inline. Takes NO argument — gtd ships a single template and no
 * longer offers a choice. Dispatched like `lsp` — BEFORE the
 * closeReviewWindow/dispatch/openReviewWindow block — because it is the ONE
 * command that must run with no workflow configured yet: it needs no
 * `ConfigService` (which would throw the "no workflow" error pre-init) and no
 * review window. It still runs the repo-root guard (it writes `.gtdrc.json` at
 * the root) and refuses to clobber an existing config. It also writes each
 * agent state's prompt as a standalone `gtd-prompts/<state>.md` file the config
 * references via `./` (see `renderInitScaffold`), so prompts are editable
 * Markdown rather than JSON-escaped strings. Everything is left UNCOMMITTED, so
 * the message warns to commit it all before the first `gtd step` (an
 * uncommitted config/prompt is a pending change the initial state's `* **` edge
 * would otherwise capture).
 */
const runInitCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, GitService | FileSystem.FileSystem | Cwd> =>
  Effect.gen(function* () {
    const args = commandArgs(argv)
    if (args.length > 0) {
      return yield* Effect.fail(
        new Error(`gtd init: too many arguments — init takes no argument, got: ${args.join(", ")}`),
      )
    }
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    const inRepo = yield* assertInitLocation(git, fs)
    const { root } = yield* Cwd
    if (yield* configPresentAt(root)) {
      return yield* Effect.fail(
        new Error("gtd init: a gtd config already exists — remove it before re-initializing"),
      )
    }
    const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))
    const scaffold = renderInitScaffold()
    yield* fs
      .writeFileString(join(root, ".gtdrc.json"), scaffold.config)
      .pipe(Effect.mapError(toError))
    for (const prompt of scaffold.prompts) {
      const full = join(root, prompt.path)
      yield* fs.makeDirectory(dirname(full), { recursive: true }).pipe(Effect.mapError(toError))
      yield* fs.writeFileString(full, prompt.content).pipe(Effect.mapError(toError))
    }
    if (json) {
      write(
        JSON.stringify({
          written: ".gtdrc.json",
          workflow: "unified",
          prompts: scaffold.prompts.map((p) => p.path),
          inRepo,
        }) + "\n",
      )
    } else {
      const promptCount = scaffold.prompts.length
      const wrote =
        `Wrote .gtdrc.json with the bundled unified workflow, and its ${promptCount} agent ` +
        `prompt${promptCount === 1 ? "" : "s"} as editable Markdown under ${PROMPTS_DIR}/ ` +
        `(referenced from the config).\n\n`
      const nextSteps = inRepo
        ? `Review and commit them before starting: an uncommitted .gtdrc.json (or prompt\n` +
          `file) counts as a pending change, so the initial state would capture it on the\n` +
          `first step. Once committed, run \`gtd step human\` to begin.\n`
        : `This directory is not a git repository, so there is nothing to commit here. The\n` +
          `config applies to any gtd repository nested below it — gtd discovers it by\n` +
          `walking up from the repository root. Run \`gtd step human\` from such a repo to\n` +
          `begin.\n`
      write(wrote + nextSteps)
    }
  })

/**
 * Resolve HEAD's rest, the current process run, and the template context for
 * rendering that rest's OWN state/actor — the common prefix shared by `gtd
 * next` and `gtd status` (each fetches `git` itself first, since
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
    const config = yield* (yield* ConfigService).load
    const worktree = yield* WorktreeReader
    const envVars = yield* EnvVars
    const rest = yield* resolveRest()
    const run = yield* computeProcessRun(git, rest.def)
    const vars = resolveVars(config.workflowVars, config.rcVars, envVars.all)
    const reviewBase = yield* reviewBaseHash(git, rest.def, run)
    const context = yield* buildTemplateContext(
      git,
      worktree.read,
      rest.state,
      rest.actor,
      run,
      vars,
      rest.stateDef.on,
      0,
      undefined,
      reviewBase,
    )
    return { rest, run, context }
  })

/** The user-facing message for a `step` refusal — out-of-turn names the awaited actor, no-match names every declared pattern. */
const formatStepRefusal = (invoker: string, refusal: StepRefusal): string =>
  refusal.reason === "out-of-turn"
    ? `gtd step ${invoker}: out of turn — "${refusal.state}" awaits ${refusal.awaits}`
    : `gtd step ${invoker}: no declared pattern matches the pending changes at "${refusal.state}" — declared patterns: ${
        refusal.patterns.length > 0 ? refusal.patterns.join(", ") : "(none)"
      }`

/**
 * Authenticate `invoker` against the resolved rest and perform the one
 * resulting transition (commit or squash) for `gtd step`.
 * Refusals fail the Effect with a formatted message; a no-op returns
 * `subject: null` rather than failing (exit zero, per the plan's "clean
 * no-op exits zero").
 */
const stepAsActor = (
  invoker: string,
  cost?: number,
  model?: string,
): Effect.Effect<
  {
    readonly state: string
    readonly subject: string | null
    readonly cost: number | null
    readonly model: string | null
  },
  Error,
  ProgramRequirements
> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const worktree = yield* WorktreeReader
    const envVars = yield* EnvVars
    const rest = yield* resolveRest()
    const run = yield* computeProcessRun(git, rest.def)
    const changes = yield* pendingChanges(git)
    const decision = step(rest.def, rest.state, invoker, { changes, processTrace: run.trace })

    if (decision.kind === "refusal") {
      return yield* Effect.fail(new Error(formatStepRefusal(invoker, decision)))
    }

    if (decision.kind === "noop") {
      return { state: decision.state, subject: null, cost: null, model: null }
    }

    const executable: ExecutableDecision = decision
    const vars = resolveVars(config.workflowVars, config.rcVars, envVars.all)
    const renderedState = decision.kind === "squash" ? decision.state : rest.state
    const context = yield* buildTemplateContext(
      git,
      worktree.read,
      renderedState,
      invoker,
      run,
      vars,
      rest.def.states[renderedState]?.on,
      cost ?? 0,
      model,
    )
    // Steering-file gate: before capturing a normal turn, format the rest
    // state's steering file in place and validate it — so whoever just acted
    // (a producing agent OR a human editing at a gate) hands the next rest a
    // tidy, well-formed file. Invalid content refuses the step (see the helper,
    // which no-ops for a squash and when there is nothing to validate).
    yield* enforceSteeringGate(worktree.read, invoker, rest, context, decision.kind)
    // Review sign-off gate (edge): refuse a deleted review doc or an unfinished
    // review with no comment before either can commit (see the helper).
    yield* enforceReviewSignoffGate(worktree.read, invoker, rest, context, changes, decision.kind)
    const outcome = yield* executeDecision(git, run, executable, context, cost, model)
    return {
      state: rest.state,
      subject: outcome.kind === "noop" ? null : outcome.subject,
      cost: cost ?? null,
      model: model ?? null,
    }
  })

/** Renders `stepAsActor`'s result for `gtd step`. */
const reportStepResult = (
  result: {
    readonly state: string
    readonly subject: string | null
    readonly cost: number | null
    readonly model: string | null
  },
  json: boolean,
  write: (chunk: string) => void,
): void => {
  if (json) {
    write(
      JSON.stringify({
        state: result.state,
        subject: result.subject,
        ...(result.cost !== null ? { cost: result.cost } : {}),
        ...(result.model !== null ? { model: result.model } : {}),
      }) + "\n",
    )
  } else {
    write(
      result.subject !== null
        ? `committed: ${result.subject}\n`
        : `nothing to do at "${result.state}"\n`,
    )
  }
}

/** `gtd step <actor> [--cost=<n>] [--model=<name>]`: authenticate as `<actor>` and perform the one resulting transition, recording `--cost`/`--model` as a `Gtd-Cost:` trailer. */
const runStepCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
  cost: number | undefined,
  model: string | undefined,
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
    const result = yield* stepAsActor(args[0]!, cost, model)
    reportStepResult(result, json, write)
  })

/**
 * `gtd review <commitish>`: start a brand NEW review process at the active
 * workflow's declared `reviewEntry: true` state (see
 * `PatternMachine.reviewEntryStateOf`), reviewing `<commitish>..HEAD` — e.g. a
 * colleague's PR branch pushed on top of a shared base, with no gtd process of
 * its own. Writes an ordinary EMPTY turn commit
 * (`gtd(human): <review-entry-state>`) carrying the resolved `<commitish>`'s
 * full hash as a `Gtd-Review-Base:` trailer (`withReviewBaseTrailer`) —
 * `computeProcessRun` reads that trailer back off this same commit (its
 * process's own oldest) to override the new process's diff base, so the
 * ENTIRE existing review flow (reviewing → await-review → feedback laps, the
 * `await-review` review checkout window) operates over `<commitish>..HEAD`
 * with zero duplicated logic — see `src/Edge.ts`/`src/ReviewWindow.ts`.
 *
 * Any failure below is a plain refusal: nothing is written.
 *
 * a. The machine must currently rest at the workflow's INITIAL state — a
 *    plain non-gtd branch (the normal case) resolves there via the
 *    inert-subject rule (STATES.md §5); a process already underway refuses.
 * b. The working tree must be clean.
 * c. The active workflow must declare a `reviewEntry: true` state.
 * d. `<commitish>` must resolve to a commit, be an ancestor of HEAD, and
 *    differ from HEAD (nothing to review otherwise).
 */
const runReviewCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    const args = commandArgs(argv)
    if (args.length === 0) {
      return yield* Effect.fail(new Error("gtd review: missing <commitish> argument"))
    }
    if (args.length > 1) {
      return yield* Effect.fail(
        new Error(
          `gtd review: too many arguments — expected one <commitish>, got: ${args.join(", ")}`,
        ),
      )
    }
    const commitish = args[0]!

    const git = yield* GitService
    const rest = yield* resolveRest()
    if (rest.state !== initialStateOf(rest.def)) {
      return yield* Effect.fail(
        new Error(
          `gtd review: a process is already underway (resting at "${rest.state}") — finish or abandon it before starting a review`,
        ),
      )
    }

    const changes = yield* pendingChanges(git)
    if (changes.length > 0) {
      return yield* Effect.fail(
        new Error("gtd review: the working tree must be clean before starting a review"),
      )
    }

    const entryState = reviewEntryStateOf(rest.def)
    if (entryState === undefined) {
      return yield* Effect.fail(
        new Error("gtd review: the active workflow declares no review entry state"),
      )
    }

    const resolvedBase = yield* git
      .resolveRef(commitish)
      .pipe(
        Effect.mapError(() => new Error(`gtd review: "${commitish}" does not resolve to a commit`)),
      )
    const headHash = yield* git.resolveRef("HEAD")
    if (resolvedBase === headHash) {
      return yield* Effect.fail(new Error(`gtd review: "${commitish}" is HEAD — nothing to review`))
    }
    const isBaseAncestor = yield* git.isAncestor(resolvedBase, "HEAD")
    if (!isBaseAncestor) {
      return yield* Effect.fail(new Error(`gtd review: "${commitish}" is not an ancestor of HEAD`))
    }

    const subject = stateSubject("human", entryState)
    yield* git.commitAsIs(withReviewBaseTrailer(subject, resolvedBase))
    if (json) {
      write(JSON.stringify({ state: entryState, subject }) + "\n")
    } else {
      write(`committed: ${subject}\n`)
    }
  })

/**
 * The self-validation instruction gtd APPENDS to a `prompt` rest that declares
 * both `file:` and `mode:` — i.e. a state whose actor hands over a steering
 * file `gtd validate` formats and checks. Appended ONLY to plain `gtd next`
 * output (for a human or a simple driver who reads the prompt and hands it to
 * an agent, so the agent self-validates); withheld from `gtd next --json`,
 * where the driving loop instead runs `gtd validate` after the turn and
 * re-prompts on findings (see `bin/gtd-loop` / `skills/loop/SKILL.md`). This is
 * advisory: `gtd step` runs the same format-and-validate gate and REFUSES a
 * turn whose steering file is invalid (see `stepAsActor`), so a malformed file
 * is never captured whether or not this instruction was followed.
 */
const selfValidateInstruction = (file: string): string =>
  `\nBefore finishing your turn, run \`gtd validate\` — it formats and checks ` +
  `${file} — and fix every violation it reports until it exits cleanly. Do not ` +
  `finish while it still reports violations.\n`

/** True when a rendered rest is a `prompt` turn that hands over a validatable steering file (`file:`+`mode:` both declared). */
const emitsValidatablePrompt = (rendered: RenderedRest): boolean =>
  rendered.kind === "prompt" && rendered.file !== undefined && rendered.mode !== undefined

/** `gtd next [--json]`: pure emitter of the resolved rest's rendered content (no mutation). */
/** `gtd next --json`'s single-line object — omitting each optional key (never `null`-valued) when its source is unset, exactly like `gtd status --json`. */
const nextJsonOutput = (rendered: RenderedRest): string =>
  JSON.stringify({
    state: rendered.state,
    actor: rendered.actor,
    kind: rendered.kind,
    content: rendered.content,
    ...(rendered.model !== undefined ? { model: rendered.model } : {}),
    ...(rendered.memory !== undefined ? { memory: rendered.memory } : {}),
    ...(rendered.file !== undefined ? { file: rendered.file } : {}),
    ...(rendered.mode !== undefined ? { mode: rendered.mode } : {}),
    ...(rendered.edges.length > 0 ? { edges: rendered.edges } : {}),
  }) + "\n"

/** `gtd next`'s plain-text output: the rendered content (newline-terminated), plus the self-validation instruction when the rest is a validatable prompt (see `emitsValidatablePrompt`). */
const nextPlainOutput = (rendered: RenderedRest): string => {
  const base = rendered.content.endsWith("\n") ? rendered.content : rendered.content + "\n"
  return emitsValidatablePrompt(rendered) ? base + selfValidateInstruction(rendered.file!) : base
}

const runNextCommand = (
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const { rest, context } = yield* resolveRestContext(git)
    const rendered = yield* renderRest(rest, context)
    write(json ? nextJsonOutput(rendered) : nextPlainOutput(rendered))
  })

/** Format the resolved state's steering file (in place) then validate it. */
interface SteeringCheck {
  /** The rendered `file:` path, or `undefined` when the state declares no `file:`/`mode:`. */
  readonly file: string | undefined
  /** True when a steering file was actually present and got formatted + validated (false when the state declares none, or the file is absent — a deletion). */
  readonly present: boolean
  /** The parser findings (empty when `present` is false). */
  readonly errors: readonly string[]
}

/**
 * Format the resolved rest's steering file in place, then validate its
 * formatted contents. When the state declares both `file:` and `mode:` and
 * that file exists in the working tree, the mode's format-then-validate pair
 * runs over it — each half resolved independently from the `modes:` map and
 * gtd's built-in `qa`/`review` validators beneath it (see
 * `src/SteeringMode.ts`). `present` is false — and nothing is
 * formatted or validated — when the state declares no steering file, or the
 * file is absent (e.g. `building` deleted `.gtd/TODO.md`, or a human deleted
 * `.gtd/REVIEW.md` to approve), so those flows pass cleanly. Shared by
 * `gtd validate` and the `gtd step` capture gate, so both format and check the
 * SAME way — an agent's fresh draft and a human's edit are treated alike.
 */
const formatAndCheckSteeringFile = (
  worktreeRead: (path: string) => string,
  rest: ResolvedRest,
  context: TemplateContext,
): Effect.Effect<SteeringCheck, Error, FileSystem.FileSystem | Cwd> =>
  Effect.gen(function* () {
    const file = yield* renderFile(rest.stateDef, context)
    const mode = rest.stateDef.mode
    if (file === undefined || mode === undefined) return { file, present: false, errors: [] }
    const fs = yield* FileSystem.FileSystem
    if (!(yield* fs.exists(file))) return { file, present: false, errors: [] }
    const resolved = resolveSteeringMode(rest.def, mode)
    if (resolved === undefined) {
      // `validateDefinition` rejects an unresolvable `mode:` at load time, so
      // this is a defensive branch, not a reachable config path.
      return yield* Effect.fail(new Error(unknownModeMessage(rest.def, rest.state, mode)))
    }
    const { root } = yield* Cwd
    const errors = yield* formatAndValidateSteeringFile(
      resolved,
      file,
      () => worktreeRead(file),
      context,
      root,
    )
    return { file, present: true, errors }
  })

/**
 * The `gtd step` capture gate: format + validate the rest state's steering file
 * (see `formatAndCheckSteeringFile`) and FAIL with the findings when it is
 * invalid, so a malformed steering file — an agent's draft or a human's edit —
 * is never committed. A no-op when there is nothing to validate.
 */
const enforceSteeringGate = (
  worktreeRead: (path: string) => string,
  invoker: string,
  rest: ResolvedRest,
  context: TemplateContext,
  kind: ExecutableDecision["kind"],
): Effect.Effect<void, Error, FileSystem.FileSystem | Cwd> =>
  Effect.gen(function* () {
    // Only a normal commit captures the rest state's steering file; a squash
    // discards it, and a no-op writes nothing.
    if (kind !== "commit") return
    const gate = yield* formatAndCheckSteeringFile(worktreeRead, rest, context)
    if (gate.errors.length > 0) {
      return yield* Effect.fail(
        new Error(
          `gtd step ${invoker}: ${gate.file} is not valid at "${rest.state}" — fix these before stepping:\n${gate.errors
            .map((e) => `  - ${e}`)
            .join("\n")}`,
        ),
      )
    }
  })

/** The `mode:` name of gtd's built-in REVIEW.md checkbox validator — the only mode the sign-off gate below understands. */
const REVIEW_MODE = "review"

/** Normalize every markdown checkbox to a single placeholder so a pure `[ ]`→`[x]` tick is invisible to a text comparison; any surviving difference is a human note. */
const normalizeCheckboxes = (content: string): string => content.replace(/\[[ xX]\]/g, "[_]")

/** The verdict of the pure `classifyReviewSignoff` — `allow` lets the step commit, `refuse` fails it with `reason`. */
export type ReviewSignoffVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "refuse"; readonly reason: string }

/**
 * The PURE core of the review sign-off gate (see `enforceReviewSignoffGate`).
 * Given the agent's `original` review doc, the reviewer's `current` copy,
 * whether a non-`.gtd/` file changed this step (`hasCodeChange`), and whether
 * the doc was deleted (`reviewDocDeleted`), decide whether the step may commit.
 * A comment — a code edit, or a note (the doc differs beyond a `[ ]`→`[x]` tick)
 * — is always allowed (it becomes a feedback round). Two dead ends refuse: a
 * deleted doc, and an all-tick-flip step that still leaves a box unticked with
 * no comment (an unfinished review). Kept separate from the Effect so it is
 * directly unit-tested (see program.test.ts).
 */
export const classifyReviewSignoff = (input: {
  readonly file: string
  readonly stateName: string
  readonly invoker: string
  readonly reviewDocDeleted: boolean
  readonly hasCodeChange: boolean
  readonly original: string
  readonly current: string
}): ReviewSignoffVerdict => {
  if (input.reviewDocDeleted) {
    return {
      kind: "refuse",
      reason: `gtd step ${input.invoker}: ${input.file} was deleted at "${input.stateName}" — restore it and tick the boxes to sign off, or leave a note (or edit code) to request changes.`,
    }
  }
  // A comment — a code edit, or a note (doc differs beyond a checkbox flip) — is
  // a feedback round; let it commit.
  if (input.hasCodeChange) return { kind: "allow" }
  if (normalizeCheckboxes(input.original) !== normalizeCheckboxes(input.current)) {
    return { kind: "allow" }
  }
  // Only checkbox flips, no comment: a sign-off needs EVERY box ticked.
  const unticked = input.current.match(/^[ \t]*-[ \t]*\[[ \t]*\]/gm)?.length ?? 0
  if (unticked > 0) {
    return {
      kind: "refuse",
      reason: `gtd step ${input.invoker}: ${unticked} review item(s) still unticked and no comment at "${input.stateName}" — finish reviewing (tick every box), or leave a note (or edit code) to request a change.`,
    }
  }
  return { kind: "allow" }
}

/**
 * The review sign-off gate (edge, not engine — like the review window it lives
 * at `src/program.ts`, and the pure `PatternMachine.step` never sees it). At a
 * review gate (a `reviewWindow: true` state with `mode: review`, i.e. the
 * unified template's `await-review`), the ROUTING is uniform — every human step
 * goes to `review-deciding`, which decides sign-off vs. feedback from the step's
 * content. But two content-shaped dead ends a file-pattern edge can't
 * distinguish must never commit, so this gate gathers the step's shape and hands
 * it to the pure `classifyReviewSignoff` BEFORE `executeDecision`, failing on a
 * `refuse` verdict. A no-op when the state is not a review gate, or the decision
 * is a squash/no-op.
 */
const enforceReviewSignoffGate = (
  worktreeRead: (path: string) => string,
  invoker: string,
  rest: ResolvedRest,
  context: TemplateContext,
  changes: readonly PendingChange[],
  kind: ExecutableDecision["kind"],
): Effect.Effect<void, Error, FileSystem.FileSystem | Cwd | GitService> =>
  Effect.gen(function* () {
    if (kind !== "commit") return
    if (!isReviewWindowState(rest.def, rest.state) || rest.stateDef.mode !== REVIEW_MODE) return
    const file = yield* renderFile(rest.stateDef, context)
    if (file === undefined) return

    const git = yield* GitService
    const original = yield* git
      .readFileAtRef("HEAD", file)
      .pipe(Effect.catchAll(() => Effect.succeed("")))
    const current = yield* Effect.try(() => worktreeRead(file)).pipe(
      Effect.catchAll(() => Effect.succeed("")),
    )
    const verdict = classifyReviewSignoff({
      file,
      stateName: rest.state,
      invoker,
      reviewDocDeleted: changes.some((c) => c.path === file && c.status === "D"),
      hasCodeChange: changes.some((c) => !c.path.startsWith(".gtd/")),
      original,
      current,
    })
    if (verdict.kind === "refuse") return yield* Effect.fail(new Error(verdict.reason))
  })

/**
 * `gtd validate [--json]`: format (in place) then validate the steering file
 * the resolved rest declares (`file:` rendered, `mode:` selecting how), over
 * its WORKING-TREE contents. A state with no `file:`/`mode:`, or an absent
 * file, has nothing to validate (exit 0). A clean verdict exits 0; violations
 * FAIL the Effect with the findings (one per line), so the process exits
 * non-zero — the signal a producing agent (or the driver) loops on until the
 * file is valid. A built-in mode reuses the canonical `OpenQuestions`/
 * `ReviewDoc` parsers (the same the LSP publishes), so there is one source of
 * truth per format and no bash port; any `modes:`-declared command runs
 * instead (or, for `format:`, in addition).
 */
const runValidateCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    yield* rejectExtraArgs("validate", argv)
    const git = yield* GitService
    const worktree = yield* WorktreeReader
    const { rest, context } = yield* resolveRestContext(git)
    const { file, present, errors } = yield* formatAndCheckSteeringFile(
      worktree.read,
      rest,
      context,
    )
    if (!present) {
      if (json) write(JSON.stringify({ state: rest.state, valid: true, errors: [] }) + "\n")
      else write(`nothing to validate at "${rest.state}"\n`)
      return
    }
    if (errors.length === 0) {
      if (json) {
        write(
          JSON.stringify({
            state: rest.state,
            file,
            mode: rest.stateDef.mode,
            valid: true,
            errors: [],
          }) + "\n",
        )
      } else {
        write(`${file}: valid\n`)
      }
      return
    }
    return yield* Effect.fail(
      new Error(`${file} is not valid:\n${errors.map((e) => `  - ${e}`).join("\n")}`),
    )
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

/**
 * True when the per-model breakdown adds information beyond the `Cost:` total:
 * more than one model, or a single model that carries an actual `--model` tag
 * (a lone `unspecified` bucket just restates the total, so it's suppressed).
 */
const breakdownIsInformative = (byModel: readonly ModelCost[]): boolean =>
  byModel.length > 1 || (byModel.length === 1 && byModel[0]!.model !== UNATTRIBUTED_MODEL)

/** The plain-text `Cost:` line(s) for `gtd status` — empty when nothing recorded, plus an indented per-model split when informative. */
const costStatusLines = (cost: number, byModel: readonly ModelCost[]): string[] => {
  if (cost <= 0) return []
  const lines = [`Cost: ${cost}`]
  if (breakdownIsInformative(byModel)) {
    for (const m of byModel) lines.push(`  ${m.model}: ${m.cost}`)
  }
  return lines
}

/** `gtd status --json`'s emission — `{state, actor, changes, model?, memory?, file?, mode?, cost?, costByModel?, edges?}`. */
const writeStatusJson = (
  write: (chunk: string) => void,
  rest: ResolvedRest,
  statusChanges: readonly StatusChange[],
  model: string | undefined,
  memory: string | undefined,
  file: string | undefined,
  cost: number,
  costByModel: readonly ModelCost[],
): void => {
  const edges = toTemplateEdges(rest.stateDef.on)
  write(
    JSON.stringify({
      state: rest.state,
      actor: rest.actor,
      changes: statusChanges,
      ...(model !== undefined ? { model } : {}),
      ...(memory !== undefined ? { memory } : {}),
      ...(file !== undefined ? { file } : {}),
      ...(rest.stateDef.mode !== undefined ? { mode: rest.stateDef.mode } : {}),
      ...(cost > 0 ? { cost } : {}),
      ...(cost > 0 ? { costByModel } : {}),
      ...(edges.length > 0 ? { edges } : {}),
    }) + "\n",
  )
}

/** `gtd status`'s plain-text emission — `State:`/`Awaits:`/`Model:`/`Memory:`/`File:`/`Mode:`/`Cost:`/`Pending:` lines. */
const writeStatusPlain = (
  write: (chunk: string) => void,
  rest: ResolvedRest,
  statusChanges: readonly StatusChange[],
  model: string | undefined,
  memory: string | undefined,
  file: string | undefined,
  cost: number,
  costByModel: readonly ModelCost[],
): void => {
  const lines = [`State: ${rest.state}`, `Awaits: ${rest.actor}`]
  if (model !== undefined) lines.push(`Model: ${model}`)
  if (memory !== undefined) lines.push(`Memory: ${memory}`)
  if (file !== undefined) lines.push(`File: ${file}`)
  if (rest.stateDef.mode !== undefined) lines.push(`Mode: ${rest.stateDef.mode}`)
  lines.push(...costStatusLines(cost, costByModel))
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
    const memory = yield* renderMemory(rest.stateDef, context)
    const file = yield* renderFile(rest.stateDef, context)
    const statusChanges = computeStatusChanges(rest.stateDef.on ?? [], changes)
    if (json) {
      writeStatusJson(
        write,
        rest,
        statusChanges,
        model,
        memory,
        file,
        context.processCost,
        context.processCostByModel,
      )
    } else {
      writeStatusPlain(
        write,
        rest,
        statusChanges,
        model,
        memory,
        file,
        context.processCost,
        context.processCostByModel,
      )
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
    const config = yield* (yield* ConfigService).load
    write(renderMermaid(config.workflow))
  })

const KNOWN_SUBCOMMANDS = ["step", "review", "next", "status", "validate", "mermaid"] as const
type KnownSubcommand = (typeof KNOWN_SUBCOMMANDS)[number]

/**
 * `--version`/`-v`/`version` or `--help`/`-h`/`help`: short-circuits before any
 * git or state work, so it works outside a repo too. The bare `version`/`help`
 * subcommands are equivalent to their flag forms. Exported so main.ts can run
 * the same check synchronously BEFORE the Effect runtime builds any layer —
 * layer construction must never observe a version/help invocation.
 */
export const runVersionOrHelp = (
  argv: readonly string[],
  write: (chunk: string) => void,
): boolean => {
  const positional = argv.slice(2).find((a) => !a.startsWith("--"))
  if (argv.includes("--version") || argv.includes("-v") || positional === "version") {
    write(GTD_VERSION + "\n")
    return true
  }
  if (argv.includes("--help") || argv.includes("-h") || positional === "help") {
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

/**
 * `gtd init` writes only a `.gtdrc.json` (+ prompt files) — it derives no state,
 * so unlike the state commands it need not sit in a git repository at all. It
 * may run EITHER at a repository root OR in a directory outside any repository —
 * the latter scaffolds a shared config a nested repo picks up by walking up the
 * cwd→home chain (see the parent-dir layout in docs/configuration.md). The one
 * placement it must refuse is a repository SUBDIRECTORY: gtd runs from the repo
 * root and discovers config by walking UP, so a config written below the root
 * would silently never be found. Returns whether cwd is inside a repository (at
 * its root), so the caller can tailor the "commit before starting" guidance —
 * there is nothing to commit outside a repo.
 */
const assertInitLocation = (
  git: GitOperations,
  fs: FileSystem.FileSystem,
): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    const topLevel = yield* Effect.either(git.topLevel())
    // `topLevel` fails only outside a git repository — there, init is allowed.
    if (topLevel._tag === "Left") return false
    const topReal = yield* fs.realPath(topLevel.right)
    const cwdReal = yield* fs.realPath(process.cwd())
    if (topReal !== cwdReal) {
      return yield* Effect.fail(
        new Error(
          `gtd init must be run from the repository root (${topLevel.right}) or from a ` +
            `directory outside any git repository; the current directory is a repository ` +
            `subdirectory: ${process.cwd()}`,
        ),
      )
    }
    return true
  })

/** Dispatches to the named `run*Command` handler for every known subcommand. */
const dispatchKnownSubcommand = (
  sub: KnownSubcommand,
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
  cost: number | undefined,
  model: string | undefined,
): Effect.Effect<void, Error, ProgramRequirements> => {
  switch (sub) {
    case "step":
      return runStepCommand(argv, json, write, cost, model)
    case "review":
      return runReviewCommand(argv, json, write)
    case "next":
      return runNextCommand(json, write)
    case "status":
      return runStatusCommand(argv, json, write)
    case "validate":
      return runValidateCommand(argv, json, write)
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
  /** argv array (e.g. `["node", "gtd.js", "step", "agent"]`). Defaults to `process.argv`. */
  argv?: string[]
  /** Sink for stdout output. Defaults to `process.stdout.write.bind(process.stdout)`. */
  write?: (chunk: string) => void
}

/**
 * Factory that returns the gtd driver Effect with the given I/O options.
 *
 * The returned Effect requires `GitService | FileSystem.FileSystem |
 * ConfigService | Cwd | WorktreeReader | EnvVars`. Production code calls
 * this with no arguments; the test world supplies an in-memory layer set and
 * captures stdout via the `write` callback.
 *
 * v3 command surface: `step <actor>` / `next` / `status` / `validate` /
 * `mermaid` (see `src/Edge.ts` and `docs/design/pattern-machine-plan.md` §3),
 * plus `lsp` and `init` — both dispatched before the config-reading
 * path since they must work with no workflow configured yet. Bare `gtd` or an
 * unknown subcommand is a usage error. Shared setup (argv parsing, the
 * repo-root guard) lives here; each subcommand's own logic is a named
 * `run*Command` function above.
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
    // silently degrade to plain-text mode. `--json` and `--cost=<n>` are the
    // only long options; `--version`/`--help` (and their short forms)
    // short-circuited above. A bare `--cost` (no `=`) is left for
    // `parseCostFlag` to reject with a value-specific message.
    const unknownOption = argv
      .slice(2)
      .find(
        (a) =>
          a.startsWith("--") &&
          a !== "--json" &&
          a !== "--cost" &&
          a !== "--model" &&
          !a.startsWith(COST_FLAG) &&
          !a.startsWith(MODEL_FLAG),
      )
    if (unknownOption !== undefined) {
      return yield* Effect.fail(
        new Error(`gtd: unknown option '${unknownOption}' — see \`gtd --help\``),
      )
    }

    // `--cost`/`--model` record the just-finished invocation's token cost and
    // model as a `Gtd-Cost:` trailer on the turn commit (see `parseStepFlags`).
    const { cost, model } = yield* parseStepFlags(argv, positional)

    if (positional === "lsp") {
      return yield* runLspCommand(argv, json)
    }

    if (positional === "init") {
      return yield* runInitCommand(argv, json, write)
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

    // Re-arm the window after the subcommand — on success AND on refusal/error,
    // and after read-only commands too (every command opts into window
    // management), so the editor's diff view stays consistent no matter which
    // command the loop last ran. The subcommand's own error takes priority; a
    // re-arm failure only surfaces when the subcommand itself succeeded.
    const outcome = yield* Effect.either(
      dispatchKnownSubcommand(sub, argv, json, write, cost, model),
    )
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
