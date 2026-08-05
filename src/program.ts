import { createRequire } from "node:module"
import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { Effect, Either, Option, Runtime } from "effect"
import { configPresentAt, ConfigService } from "./Config.js"
import { renderInitScaffold } from "./workflows/templates.js"
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
  renderLabel,
  renderMemory,
  renderModel,
  renderOnEdges,
  renderRest,
  resolveRest,
  resolveVars,
  toTemplateEdges,
  UNATTRIBUTED_MODEL,
  withRenderedOn,
  withEntryTrailers,
  type ExecutableDecision,
  type ModelCost,
  type ProcessRun,
  type RenderedRest,
  type ResolvedRest,
} from "./Edge.js"
import {
  closeReviewWindow,
  openReviewWindow,
  reviewBaseHash,
  REVIEW_HEAD_REF,
} from "./ReviewWindow.js"
import {
  clearRetainedHistory,
  readRetainedHistory,
  restorability,
  retainHistory,
} from "./RetainedHistory.js"
import { startLspServer } from "./Lsp.js"
import {
  buildCurrentStateModel,
  buildVizModel,
  openInBrowser,
  startVizServer,
  type CurrentStateModel,
  type VizModel,
} from "./Visualize.js"
import {
  formatAndValidateSteeringFile,
  resolveSteeringMode,
  unknownModeMessage,
} from "./SteeringMode.js"
import {
  enterableStates,
  entryBaseTemplateOf,
  initialStateOf,
  isAnswerGateState,
  isRequireProgressState,
  isReviewWindowState,
  matchesPattern,
  parsePattern,
  parseStateSubject,
  stateSubject,
  step,
  type OnEdge,
  type PendingChange,
  type StepRefusal,
} from "./PatternMachine.js"
import { parseOpenQuestions } from "./OpenQuestions.js"
import { renderStateTemplate, varsOnlyContext, type TemplateContext } from "./PatternTemplates.js"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

const HELP_TEXT = `Usage: gtd [command] [options]

Commands:
  (no command), loop
                   Launch the loop driver (bin/gtd), which repeatedly drives
                   an agent through gtd next/gtd step calls until the
                   workflow rests at a human gate (a non-autonomous state)
                   or settles. A bare gtd invocation and gtd loop both
                   launch it identically
  init             Scaffold a minimal .gtdrc.json for this repo, seeding the
                   default variables you are most likely to change (the test
                   command) and a Prettier formatting suggestion. gtd runs its
                   built-in workflow by default, so no workflow is written —
                   add a workflow: key only to customize the machine itself.
                   Takes no argument. Run once per repo; refuses if a gtd
                   config already exists. Leaves the file uncommitted for you
                   to review and commit
  step <actor>     Authenticate as <actor>, match the resolved rest's
                   declared patterns against the pending changes, and commit
                   (or squash) the one resulting transition. Pass
                   --cost=<n> (optionally --model=<name>) to record the
                   just-finished invocation's token cost and model on the
                   turn commit (summed into it.processCost/processCostByModel).
                   Pass --entry <state> to start a brand NEW process at
                   <state> instead — any declared, non-commit state (e.g.
                   review-gate.check or fix-precheck on the bundled unified
                   template) — with repeatable --var <name>=<value> supplying
                   that new process's fixed it.vars overrides
  (no command) --entry <state>
                   Short form of 'step human --entry <state>' — starts a new
                   process authenticated as human, e.g.
                   'gtd --entry review-gate.check'
  abandon          End the process currently underway without completing it:
                   close any open review checkout window, then rewind HEAD to
                   the commit the process started from, keeping everything it
                   produced as uncommitted changes. A no-op when no process is
                   underway
  restore          Hard-reset HEAD back to the pre-squash tip retained by the
                   last squash/abandon (refs/worktree/gtd/history), undoing a
                   squash or bringing back an abandoned process's turns.
                   Refuses on a dirty working tree, when there is no retained
                   history, or when HEAD has advanced past the squash with
                   commits that would be lost
  next             Print the resolved rest's rendered script/prompt/message
                   (no mutation)
  status           Print the resolved rest's state/actor and which declared
                   pattern (if any) each pending change matches (no mutation)
  validate         Format and validate the steering file the resolved rest
                   declares, with its mode's commands (its file:/mode:);
                   exits non-zero with the findings when it is invalid
  lsp              Start the LSP server for .gtd/ steering files (stdio)
  visualize        Serve an interactive diagram of the active workflow on a
                   local web server (--port <n>, --no-open; --json prints the
                   model and exits)
  version          Print version and exit
  help             Print this help and exit

Options:
  --json           Output structured JSON instead of plain text
  --port=<n>       (gtd visualize only) port to serve on (default: a free port)
  --no-open        (gtd visualize only) do not open the browser
  --cost=<n>       (gtd step only) record the invocation's token cost
  --model=<name>   (gtd step only, with --cost) tag that cost's model
  --entry <state>  (gtd step, or with no command at all) start a brand new
                   process at <state> — any declared, non-commit state —
                   instead of stepping the one currently resting. Not
                   combinable with --cost/--model (an entry is not a metered
                   agent turn)
  --var <name>=<value>
                   (with --entry; repeatable) supply a fixed it.vars
                   override for the new process; the name must already be
                   declared by the workflow's own vars: or the .gtdrc vars:
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
 * `gtd: unknown option …`), so a blind prepend produced a doubled
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

/**
 * Every value `flag` carries in `argv`, in BOTH `--flag=value` and `--flag
 * value` (space-separated) forms, plus every argv INDEX consumed producing
 * them — the flag token itself, and (for the space-separated form) the next
 * token too. A trailing bare occurrence (`flag` as the very last argv token,
 * with no following value) still consumes its own index but contributes an
 * EMPTY STRING to `values` — indistinguishable from an explicit `flag=`, and
 * deliberately so: both are "no value given" and a caller that cares (see
 * `parseEntryFlags`) rejects an empty value with its own message. Repeatable
 * flags (`--var`) collect one entry per occurrence, in argv order. Shared by
 * the positional-extraction fix below (`commandArgs`, and the top-level
 * `positional` lookup in `makeProgram`) and by `parseEntryFlags`'s own
 * `--entry`/`--var` parsing, so both agree on exactly which indices a flag's
 * value occupies.
 */
export const takeFlagValues = (
  argv: readonly string[],
  flag: string,
): { readonly values: string[]; readonly consumed: Set<number> } => {
  const values: string[] = []
  const consumed = new Set<number>()
  const eqPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === flag) {
      consumed.add(i)
      if (i + 1 < argv.length) {
        values.push(argv[i + 1]!)
        consumed.add(i + 1)
      } else {
        values.push("")
      }
    } else if (arg.startsWith(eqPrefix)) {
      consumed.add(i)
      values.push(arg.slice(eqPrefix.length))
    }
  }
  return { values, consumed }
}

const ENTRY_FLAG = "--entry"
const VAR_FLAG = "--var"

/**
 * The absolute argv indices `takeFlagValues` reports as consumed for
 * `--entry`/`--var`, merged — the set both `commandArgs` and the top-level
 * `positional` lookup in `makeProgram` must SKIP so a flag's value (e.g.
 * `--entry review-gate.check`, which carries no `--` prefix of its own) is
 * never mistaken for a stray extra positional argument.
 */
const flagConsumedIndices = (argv: readonly string[]): Set<number> => {
  const consumed = new Set<number>()
  for (const i of takeFlagValues(argv, ENTRY_FLAG).consumed) consumed.add(i)
  for (const i of takeFlagValues(argv, VAR_FLAG).consumed) consumed.add(i)
  return consumed
}

/** Non-flag positional arguments past the subcommand name (argv[3..]), skipping any index `flagConsumedIndices` reports as an `--entry`/`--var` value (which carries no `--` prefix of its own and would otherwise read as a stray extra positional — see `takeFlagValues`). */
const commandArgs = (argv: readonly string[]): string[] => {
  const consumed = flagConsumedIndices(argv)
  return argv
    .map((a, i) => ({ a, i }))
    .slice(3)
    .filter(({ a, i }) => a.length > 0 && !a.startsWith("--") && !consumed.has(i))
    .map(({ a }) => a)
}

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

/**
 * Parse the `--entry <state>`/`--entry=<state>` flag and the repeatable
 * `--var <name>=<value>`/`--var=<name>=<value>` flag together (see
 * `takeFlagValues`) — mirrors `parseStepFlags`'s shape/Effect style. `--entry`
 * names the state a brand-new process should START at (see
 * `runEntryCommand`), reached via `gtd step <actor> --entry <state>` or the
 * subcommand-less short form `gtd --entry <state>` — so, like `--cost`/
 * `--model`, it is rejected outright on any OTHER command rather than
 * silently ignored. `--var` supplies that new process's fixed `it.vars`
 * overrides, and only means anything alongside `--entry`.
 *
 * - At most one `--entry` occurrence — a second is a usage error (not
 *   last-wins).
 * - A bare `--entry` with no following value is a usage error (mirrors
 *   `parseCostFlag`'s bare-`--cost` handling).
 * - Each `--var` value must be `<name>=<value>` with a non-empty name and a
 *   single-line value (mirrors `parseModelFlag`'s multiline-rejection idiom);
 *   a duplicate `--var` NAME is a usage error (no silent last-wins).
 * - `--var` present with no `--entry` is a usage error.
 *
 * Deliberately does NOT reject `--cost`/`--model` alongside `--entry` — that
 * combination check lives where `--cost`/`--model` are already validated
 * (see `makeProgram`).
 */
export const parseEntryFlags = (
  argv: readonly string[],
  positional: string | undefined,
): Effect.Effect<
  { readonly entry: string | undefined; readonly vars: Record<string, string> },
  Error
> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const entryValues = takeFlagValues(argv, ENTRY_FLAG).values
    if (entryValues.length > 1) {
      return yield* Effect.fail(new Error("gtd: --entry may be given at most once"))
    }
    const entryRaw = entryValues[0]
    if (entryRaw === "") {
      return yield* Effect.fail(
        new Error("gtd: --entry requires a value — use --entry=<state> or --entry <state>"),
      )
    }
    const entry = entryRaw
    if (entry !== undefined && positional !== "step" && positional !== undefined) {
      return yield* Effect.fail(
        new Error(
          "gtd: --entry is only valid for `gtd step` or the bare `gtd --entry <state>` form",
        ),
      )
    }

    const vars: Record<string, string> = {}
    const seenNames = new Set<string>()
    for (const raw of takeFlagValues(argv, VAR_FLAG).values) {
      const eq = raw.indexOf("=")
      if (eq <= 0) {
        return yield* Effect.fail(
          new Error(`gtd: --var must be <name>=<value> with a non-empty name — got "${raw}"`),
        )
      }
      const name = raw.slice(0, eq)
      const value = raw.slice(eq + 1)
      if (/[\r\n]/.test(value)) {
        return yield* Effect.fail(new Error(`gtd: --var ${name} must be a single-line value`))
      }
      if (seenNames.has(name)) {
        return yield* Effect.fail(new Error(`gtd: --var ${name} specified more than once`))
      }
      seenNames.add(name)
      vars[name] = value
    }
    if (entry === undefined && Object.keys(vars).length > 0) {
      return yield* Effect.fail(new Error("gtd: --var requires --entry"))
    }

    return { entry, vars }
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
 * `gtd init`: scaffold a MINIMAL `.gtdrc.json` seeding the default variables a
 * fresh project is most likely to change — the test command (`vars.testCommand`)
 * and a ready-to-edit Prettier formatting suggestion (`modes:`). It writes NO
 * `workflow:` key: gtd ships the unified workflow as its built-in default and
 * runs it whenever none is configured (see `src/Config.ts`), so there is
 * nothing to scaffold there — a project customizes the machine itself only by
 * adding a `workflow:` key. Takes NO argument. Dispatched like `lsp` — BEFORE
 * the closeReviewWindow/dispatch/openReviewWindow block — because it needs no
 * `ConfigService` and no review window. It still runs the repo-root guard (it
 * writes `.gtdrc.json` at the root) and refuses to clobber an existing config.
 * The file is left UNCOMMITTED, so the message warns to commit it before the
 * first `gtd step` (an uncommitted config counts as a pending change the
 * initial state's `* **` edge would otherwise capture).
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
    if (json) {
      write(JSON.stringify({ written: ".gtdrc.json", inRepo }) + "\n")
    } else {
      const wrote =
        `Wrote .gtdrc.json seeding the default variables (the test command) and a\n` +
        `Prettier formatting suggestion. gtd runs its built-in workflow by default — add\n` +
        `a workflow: key only if you want to customize the machine itself.\n\n`
      const nextSteps = inRepo
        ? `Review and commit it before starting: an uncommitted .gtdrc.json counts as a\n` +
          `pending change, so the initial state would capture it on the first step. Once\n` +
          `committed, run \`gtd step human\` to begin.\n`
        : `This directory is not a git repository, so there is nothing to commit here. The\n` +
          `config applies to any gtd repository nested below it — gtd discovers it by\n` +
          `walking up from the repository root. Run \`gtd step human\` from such a repo to\n` +
          `begin.\n`
      write(wrote + nextSteps)
    }
  })

/** Render a state's `on` edges against `vars` (see `renderOnEdges`), surfacing a malformed pattern template as a plain command error, exactly like a content render failure. */
const renderOnEdgesOrFail = (
  onEdges: readonly OnEdge[] | undefined,
  vars: Record<string, string>,
): Effect.Effect<readonly OnEdge[], Error> =>
  Effect.try({
    try: () => renderOnEdges(onEdges, vars),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/**
 * Resolve HEAD's rest, the current process run, and the template context for
 * rendering that rest's OWN state/actor — the common prefix shared by `gtd
 * next` and `gtd status` (each fetches `git` itself first, since
 * `gtd status` also needs it for `pendingChanges`; `stepAsActor`'s squash
 * path renders a DIFFERENT state, so it builds its own context inline
 * instead of sharing this helper). `renderedOn` is the resting state's `on`
 * edges already rendered against `it.vars` (`renderOnEdges`) — `next`/`status`
 * reuse it instead of re-rendering the same patterns themselves.
 */
const resolveRestContext = (
  git: GitOperations,
): Effect.Effect<
  {
    readonly rest: ResolvedRest
    readonly run: ProcessRun
    readonly context: TemplateContext
    readonly renderedOn: readonly OnEdge[]
  },
  Error,
  GitService | ConfigService | WorktreeReader | EnvVars
> =>
  Effect.gen(function* () {
    const config = yield* (yield* ConfigService).load
    const worktree = yield* WorktreeReader
    const envVars = yield* EnvVars
    const rest = yield* resolveRest()
    const run = yield* computeProcessRun(git, rest.def)
    const vars = resolveVars(config.workflowVars, config.rcVars, run.entryVars, envVars.all)
    const renderedOn = yield* renderOnEdgesOrFail(rest.stateDef.on, vars)
    const reviewBase = yield* reviewBaseHash(git, rest.def, run)
    const context = yield* buildTemplateContext(
      git,
      worktree.read,
      rest.state,
      rest.actor,
      run,
      vars,
      renderedOn,
      0,
      undefined,
      reviewBase,
    )
    return { rest, run, context, renderedOn }
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
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const worktree = yield* WorktreeReader
    const envVars = yield* EnvVars
    const rest = yield* resolveRest()
    const run = yield* computeProcessRun(git, rest.def)
    const changes = yield* pendingChanges(git)
    const vars = resolveVars(config.workflowVars, config.rcVars, run.entryVars, envVars.all)
    const renderedOn = yield* renderOnEdgesOrFail(rest.stateDef.on, vars)
    const decision = step(withRenderedOn(rest.def, rest.state, renderedOn), rest.state, invoker, {
      changes,
      processTrace: run.trace,
    })

    if (decision.kind === "refusal") {
      return yield* Effect.fail(new Error(formatStepRefusal(invoker, decision)))
    }

    if (decision.kind === "noop") {
      return { state: decision.state, subject: null, cost: null, model: null }
    }

    const executable: ExecutableDecision = decision
    const renderedState = decision.kind === "squash" ? decision.state : rest.state
    const renderedStateOn =
      renderedState === rest.state
        ? renderedOn
        : yield* renderOnEdgesOrFail(rest.def.states[renderedState]?.on, vars)
    const context = yield* buildTemplateContext(
      git,
      worktree.read,
      renderedState,
      invoker,
      run,
      vars,
      renderedStateOn,
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
    // Feedback-progress gate (edge): at a `requireProgress` state, refuse a
    // work-free turn that just deletes the instructions file (the "captured
    // then silently discarded" bug), exempting a NOTHING ACTIONABLE sentinel.
    yield* enforceFeedbackProgressGate(invoker, rest, context, changes, decision.kind)
    // Answer-completeness gate (edge): at an `answerGate` qa state, refuse a
    // human step while any open question is not answered (exactly one tick each)
    // — the advanced flow's product-answer/technical-answer gates.
    yield* enforceAnswerCompletenessGate(worktree.read, invoker, rest, context, decision.kind)
    if (decision.kind === "commit") {
      const target = parseStateSubject(decision.subject)?.state
      if (
        target === initialStateOf(rest.def) &&
        context.retainedDiff.trim() === "" &&
        run.startParentHash !== EMPTY_TREE
      ) {
        // A process that returns to its initial state having kept nothing (a
        // green `gtd --entry fix-precheck`: an empty entry commit + a green
        // check that changed nothing) leaves no useful history — mixed-reset
        // past its commits like `gtd abandon` rather than committing a
        // `→ idle` turn, so a
        // no-op probe never dirties the log. Pure engine is oblivious; this is
        // an edge concern like the review window and the steering gate.
        const tip = yield* git.resolveRef("HEAD")
        yield* retainHistory(git, tip, run.startParentHash)
        yield* git.mixedResetTo(run.startParentHash)
        return { state: target, subject: null, cost: null, model: null }
      }
    }
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

/**
 * `gtd step <actor> [--cost=<n>] [--model=<name>]`: authenticate as `<actor>`
 * and perform the one resulting transition, recording `--cost`/`--model` as a
 * `Gtd-Cost:` trailer. When `--entry <state>` is present, the actor argument
 * is still required (it names who authors the entry commit) but the ordinary
 * pattern-matched step never runs — dispatches to `runEntryCommand` instead
 * (see `makeProgram`'s parsing of `--entry`/`--var`, and its sibling
 * subcommand-less short form).
 */
const runStepCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
  cost: number | undefined,
  model: string | undefined,
  entryFlags: { readonly entry: string | undefined; readonly vars: Record<string, string> },
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
    const actor = args[0]!
    if (entryFlags.entry !== undefined) {
      return yield* runEntryCommand(
        actor,
        entryFlags.entry,
        entryFlags.vars,
        json,
        write,
        `gtd step ${actor} --entry ${entryFlags.entry}`,
      )
    }
    const result = yield* stepAsActor(actor, cost, model)
    reportStepResult(result, json, write)
  })

/**
 * `gtd step <actor> --entry <state> [--var <name>=<value> ...]` (or its
 * subcommand-less short form `gtd --entry <state> ...`, `actor` defaulting to
 * `human` there — see `makeProgram`): start a brand NEW process at `<state>`
 * — any declared, non-commit state (see `PatternMachine.enterableStates`) —
 * replacing the two former named commands `gtd review <commitish>`/`gtd fix`
 * with one generic mechanism. Writes an ordinary turn commit
 * (`gtd(<actor>): <state>`) carrying zero or more `Gtd-Var: <name>=<value>`
 * trailers (`withEntryTrailers`) for each `--var` override, plus — when
 * `<state>` declares a string `reviewBase:` — a `Gtd-Review-Base:` trailer
 * pinning the new process's diff base (rendered from that template against
 * the merged `it.vars`, resolved to a commit, and checked sane). Unlike the
 * old commands (which required a clean tree and used `commitAsIs`), this
 * commits via `commitAllWithPrefix` — capturing whatever the working tree
 * carries at the moment of entry, exactly like an ordinary `gtd step`
 * capture, rather than demanding a clean tree first.
 *
 * Any failure below is a plain refusal: nothing is written. Checked in order:
 *
 * 1. The machine must currently rest at the workflow's INITIAL state — a
 *    plain non-gtd branch (the normal case) resolves there via the
 *    inert-subject rule (see `resolveState`); a process already underway
 *    refuses.
 * 2. `<state>` must be one of `enterableStates(rest.def)` — every declared,
 *    non-commit state, NOT narrowed to whatever declared `entry: true` (that
 *    narrower set only seeds the workflow's own `entries.manual` reachability
 *    roots — this command lets an operator enter any of them).
 * 3. Every `--var` name must already be declared by the workflow's own
 *    `vars:` or the top-level `.gtdrc` `vars:` — an undeclared name is a
 *    usage error, not a silently-ignored override.
 * 4. When `<state>` declares a string `reviewBase:`, that template must
 *    render to a NON-BLANK commitish that resolves to a commit, is an
 *    ancestor of HEAD, and differs from HEAD.
 */
const runEntryCommand = (
  actor: string,
  entryState: string,
  varOverrides: Record<string, string>,
  json: boolean,
  write: (chunk: string) => void,
  commandLabel: string,
): Effect.Effect<void, Error, ProgramRequirements> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const envVars = yield* EnvVars
    const rest = yield* resolveRest()
    if (rest.state !== initialStateOf(rest.def)) {
      return yield* Effect.fail(
        new Error(
          `${commandLabel}: a process is already underway (resting at "${rest.state}") — finish it, or run \`gtd abandon\`, before entering`,
        ),
      )
    }

    const enterable = enterableStates(rest.def)
    if (!enterable.includes(entryState)) {
      return yield* Effect.fail(
        new Error(
          `${commandLabel}: "${entryState}" is not an enterable state — enterable states:\n${enterable
            .map((s) => `  ${s}`)
            .join("\n")}`,
        ),
      )
    }

    const declaredNames = Object.keys({ ...config.workflowVars, ...config.rcVars })
    const undeclared = Object.keys(varOverrides).filter((name) => !declaredNames.includes(name))
    if (undeclared.length > 0) {
      return yield* Effect.fail(
        new Error(
          `${commandLabel}: --var name(s) not declared by this workflow: ${undeclared.join(
            ", ",
          )} — declared: ${declaredNames.length > 0 ? declaredNames.join(", ") : "(none)"}`,
        ),
      )
    }

    const vars = resolveVars(config.workflowVars, config.rcVars, varOverrides, envVars.all)

    let base: string | undefined
    const baseTemplate = entryBaseTemplateOf(rest.def, entryState)
    if (baseTemplate !== undefined) {
      const rendered = yield* Effect.try({
        try: () => renderStateTemplate(baseTemplate, varsOnlyContext(vars, entryState)),
        catch: (e) => new Error(`${commandLabel}: ${e instanceof Error ? e.message : String(e)}`),
      })
      if (rendered.trim() === "") {
        const refs = Array.from(
          new Set(Array.from(baseTemplate.matchAll(/it\.vars\.(\w+)/g)).map((m) => m[1]!)),
        )
        return yield* Effect.fail(
          new Error(
            `${commandLabel}: "${entryState}"'s reviewBase template rendered blank — template: ${JSON.stringify(
              baseTemplate,
            )}; it.vars references: ${
              refs.length > 0 ? refs.map((r) => `it.vars.${r}`).join(", ") : "(none found)"
            }`,
          ),
        )
      }
      const resolvedBase = yield* git
        .resolveRef(rendered)
        .pipe(
          Effect.mapError(
            () => new Error(`${commandLabel}: "${rendered}" does not resolve to a commit`),
          ),
        )
      const isBaseAncestor = yield* git.isAncestor(resolvedBase, "HEAD")
      if (!isBaseAncestor) {
        return yield* Effect.fail(
          new Error(`${commandLabel}: "${rendered}" is not an ancestor of HEAD`),
        )
      }
      const headHash = yield* git.resolveRef("HEAD")
      if (resolvedBase === headHash) {
        return yield* Effect.fail(
          new Error(`${commandLabel}: "${rendered}" is HEAD — nothing to review`),
        )
      }
      base = resolvedBase
    }

    const subject = stateSubject(actor, entryState)
    yield* git.commitAllWithPrefix(
      withEntryTrailers(subject, { ...(base !== undefined ? { base } : {}), vars: varOverrides }),
    )
    if (json) {
      write(JSON.stringify({ state: entryState, subject }) + "\n")
    } else {
      write(`committed: ${subject}\n`)
    }
  })

// git's empty-tree object — `computeProcessRun`'s `startParentHash` when the
// process covers the whole history, so there is no earlier commit to rewind to.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/**
 * `gtd abandon`: end the process currently underway WITHOUT completing it,
 * returning the machine to the workflow's initial state — the recovery path out
 * of a process nobody is going to finish (`runEntryCommand`'s "already
 * underway" refusal names it: "finish it, or run `gtd abandon`, before entering").
 *
 * NOTHING is discarded. The shared bracket in `makeProgram` has already closed
 * any open review checkout window (so HEAD is the real head), and abandon then
 * `git reset --mixed`es HEAD to the commit the process started from
 * (`computeProcessRun`'s `startParentHash` — the same boundary a squash resets
 * to). Every turn commit the process wrote is dropped, and everything they
 * carried — the code, the `.gtd/` steering files — stays in the working tree as
 * uncommitted changes for the human to keep, re-commit, or discard with
 * ordinary git.
 *
 * Idempotent: resting at the initial state (a plain non-gtd branch, or a
 * just-squashed cycle) is a no-op SUCCESS, not a refusal — a recovery command
 * that fails when there is nothing to recover is a worse tool. The one refusal
 * is a process whose first commit is the repository's own root commit: there is
 * no earlier commit to rewind to.
 */
const runAbandonCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    yield* rejectExtraArgs("abandon", argv)

    const git = yield* GitService
    const rest = yield* resolveRest()
    const initial = initialStateOf(rest.def)
    if (rest.state === initial) {
      if (json) {
        write(JSON.stringify({ state: initial, abandoned: false }) + "\n")
      } else {
        write(`no gtd process is underway (resting at "${initial}") — nothing to abandon\n`)
      }
      return
    }

    const run = yield* computeProcessRun(git, rest.def)
    if (run.startParentHash === EMPTY_TREE) {
      return yield* Effect.fail(
        new Error(
          `gtd abandon: the process underway (resting at "${rest.state}") starts at the ` +
            "repository's first commit — there is no earlier commit to rewind to",
        ),
      )
    }

    const tip = yield* git.resolveRef("HEAD")
    yield* retainHistory(git, tip, run.startParentHash)

    yield* git.mixedResetTo(run.startParentHash)
    const subject = yield* git.lastCommitSubject()
    if (json) {
      write(
        JSON.stringify({
          state: initial,
          abandoned: true,
          from: rest.state,
          head: run.startParentHash,
        }) + "\n",
      )
    } else {
      write(
        `abandoned the process resting at "${rest.state}" — HEAD is back at ` +
          `${run.startParentHash.slice(0, 7)} ("${subject}"), resting at "${initial}".\n` +
          `Everything the process produced is kept as uncommitted changes (\`git status\`); ` +
          `discard them with \`git checkout -- . && git clean -fd .gtd\` for a clean tree.\n`,
      )
    }
  })

/**
 * `gtd restore`: hard-reset HEAD back to the pre-squash tip a squash or
 * `gtd abandon` retained (`RetainedHistory.ts`'s `HISTORY_REF`), undoing
 * either. Unlike `gtd abandon` (which rewinds a process still underway),
 * restore reaches BACK past a completed squash — or re-applies an abandon's
 * own retained tip — to bring the turn-by-turn history back.
 *
 * Guarded by `restorability` so it never discards work it didn't create:
 * refuses on a dirty working tree, when there is no retained history, and
 * when HEAD has advanced past the retained tip with commits that would be
 * lost by resetting.
 */
const runRestoreCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    yield* rejectExtraArgs("restore", argv)

    const git = yield* GitService

    const changes = yield* pendingChanges(git)
    if (changes.length > 0) {
      return yield* Effect.fail(
        new Error(
          "gtd restore: refuses on a dirty working tree — commit, stash, or discard your changes first.",
        ),
      )
    }

    const retained = yield* readRetainedHistory(git)
    if (Option.isNone(retained)) {
      return yield* Effect.fail(new Error("gtd restore: no retained history to restore."))
    }
    const tip = retained.value

    const before = yield* resolveRest()
    const headHash = yield* git.resolveRef("HEAD")
    const headMessage = yield* git.lastCommitMessage()
    const check = yield* restorability(git, headHash, headMessage, tip)
    if (!check.ok) {
      return yield* Effect.fail(
        new Error(
          `gtd restore: ${check.reason} — HEAD ${headHash.slice(0, 7)} is ahead of the ` +
            `retained tip ${tip.slice(0, 7)}.`,
        ),
      )
    }

    yield* git.hardResetTo(tip)
    yield* clearRetainedHistory(git)

    const after = yield* resolveRest()
    const subject = yield* git.lastCommitSubject()

    if (json) {
      write(
        JSON.stringify({ state: after.state, restored: true, to: tip, from: before.state }) + "\n",
      )
    } else {
      write(
        `restored the retained history — HEAD is back at ${tip.slice(0, 7)} ("${subject}"), ` +
          `resting at "${after.state}". Resume with the loop, or \`git reset\` to any earlier ` +
          `turn to restart from there.\n`,
      )
    }
  })

/**
 * The self-validation instruction gtd APPENDS to a `prompt` rest that declares
 * both `file:` and `mode:` — i.e. a state whose actor hands over a steering
 * file `gtd validate` formats and checks. Appended ONLY to plain `gtd next`
 * output (for a human or a simple driver who reads the prompt and hands it to
 * an agent, so the agent self-validates); withheld from `gtd next --json`,
 * where the driving loop instead runs `gtd validate` after the turn and
 * re-prompts on findings (see the `bin/gtd` loop driver). This is
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
    ...(rendered.label !== undefined ? { label: rendered.label } : {}),
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

/** The one-line marker `feedback-collecting` writes when a review round left nothing actionable — the ONLY content that lets a `requireProgress` state's instructions file be deleted without a code change (see `classifyFeedbackProgress`). */
const NOTHING_ACTIONABLE_SENTINEL = "NOTHING ACTIONABLE"

/**
 * The PURE core of the feedback-progress gate (see `enforceFeedbackProgressGate`).
 * At a `requireProgress` state the `file` is an instruction list the agent must
 * ADDRESS, then delete. Refuse a turn that deletes the file while touching no
 * code (`hasCodeChange` false) — the "review feedback captured then silently
 * discarded" bug. Two escapes ALLOW the step: the file isn't being deleted (the
 * agent left work, or the list, in place), or there IS a code change alongside
 * (real work was done). The one delete-with-no-code exception is a
 * `NOTHING ACTIONABLE` sentinel (`deletedContent`): a legitimately
 * non-actionable round makes no code change by design. Kept separate from the
 * Effect so it is directly unit-tested (see program.test.ts).
 */
export const classifyFeedbackProgress = (input: {
  readonly file: string
  readonly stateName: string
  readonly invoker: string
  readonly changes: readonly PendingChange[]
  readonly deletedContent: string
}): ReviewSignoffVerdict => {
  const fileDeleted = input.changes.some((c) => c.path === input.file && c.status === "D")
  if (!fileDeleted) return { kind: "allow" }
  const hasCodeChange = input.changes.some((c) => !c.path.startsWith(".gtd/"))
  if (hasCodeChange) return { kind: "allow" }
  if (input.deletedContent.trim().startsWith(NOTHING_ACTIONABLE_SENTINEL)) return { kind: "allow" }
  return {
    kind: "refuse",
    reason: `gtd step ${input.invoker}: ${input.file} was deleted at "${input.stateName}" without addressing its instructions — implement the changes it lists (then delete it), don't just remove the file.`,
  }
}

/**
 * The feedback-progress gate (edge, like the sign-off gate above). At a
 * `requireProgress: true` state (the unified template's `feedback-building`), a
 * turn that just deletes the instructions file without doing the work it lists
 * is refused BEFORE it can commit — the pure `classifyFeedbackProgress` decides.
 * A no-op when the state is not a `requireProgress` state or the decision is a
 * squash/no-op. The committed (pre-deletion) file content — read once here —
 * feeds the sentinel exemption.
 */
const enforceFeedbackProgressGate = (
  invoker: string,
  rest: ResolvedRest,
  context: TemplateContext,
  changes: readonly PendingChange[],
  kind: ExecutableDecision["kind"],
): Effect.Effect<void, Error, FileSystem.FileSystem | Cwd | GitService> =>
  Effect.gen(function* () {
    if (kind !== "commit") return
    if (!isRequireProgressState(rest.def, rest.state)) return
    const file = yield* renderFile(rest.stateDef, context)
    if (file === undefined) return
    const git = yield* GitService
    const deletedContent = yield* git
      .readFileAtRef("HEAD", file)
      .pipe(Effect.catchAll(() => Effect.succeed("")))
    const verdict = classifyFeedbackProgress({
      file,
      stateName: rest.state,
      invoker,
      changes,
      deletedContent,
    })
    if (verdict.kind === "refuse") return yield* Effect.fail(new Error(verdict.reason))
  })

/** The `mode:` name of gtd's built-in open-questions checkbox format — the only mode the answer-completeness gate below acts on. */
const QA_MODE = "qa"

/** The verdict of the pure `classifyAnswerCompleteness` — `allow` lets the step commit, `refuse` fails it with `reason`. */
export type AnswerCompletenessVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "refuse"; readonly reason: string }

/**
 * The PURE core of the answer-completeness gate (see
 * `enforceAnswerCompletenessGate`). Parses the working-tree `content` of a
 * `qa`-mode file and refuses when any OPEN question is not answered — EXACTLY
 * ONE checkbox ticked, and (for a ticked free-text slot) non-empty text (see
 * `OpenQuestions.answered`). An open question with NO checkbox options is also
 * unanswered — a decision can't have been made on it. Zero remaining open
 * questions (the section was deleted, or the agent surfaced none) allows the
 * step: that is BOTH the tick-then-loop path and the clean advance / accept-all
 * escape. Kept separate from the Effect so it is directly unit-tested (see
 * program.test.ts).
 */
export const classifyAnswerCompleteness = (input: {
  readonly file: string
  readonly stateName: string
  readonly invoker: string
  readonly content: string
}): AnswerCompletenessVerdict => {
  const open = parseOpenQuestions(input.content).questions.filter((q) => q.status === "open")
  const unanswered = open.filter((q) => !q.answered)
  if (unanswered.length === 0) return { kind: "allow" }
  const list = unanswered.map((q) => `  - ${q.question}`).join("\n")
  return {
    kind: "refuse",
    reason: `gtd step ${input.invoker}: ${unanswered.length} open question(s) in ${input.file} not answered at "${input.stateName}" — tick exactly one option per question (or delete a question you don't want to answer, or delete the whole "## Open Questions" section to accept the plan as-is):\n${list}`,
  }
}

/**
 * The answer-completeness gate (edge, like the sign-off gate above). At an
 * `answerGate: true` state with `mode: qa` (the unified template's
 * `product-answer`/`technical-answer`), a human step is refused unless
 * every open question in the file is answered — the pure
 * `classifyAnswerCompleteness` decides over the WORKING-TREE contents. A no-op
 * when the state is not an answer gate (so the agent's own authoring step, which
 * writes all-unticked options, is never gated), the mode isn't `qa`, or the
 * decision is a squash/no-op.
 */
const enforceAnswerCompletenessGate = (
  worktreeRead: (path: string) => string,
  invoker: string,
  rest: ResolvedRest,
  context: TemplateContext,
  kind: ExecutableDecision["kind"],
): Effect.Effect<void, Error, FileSystem.FileSystem | Cwd | GitService> =>
  Effect.gen(function* () {
    if (kind !== "commit") return
    if (!isAnswerGateState(rest.def, rest.state) || rest.stateDef.mode !== QA_MODE) return
    const file = yield* renderFile(rest.stateDef, context)
    if (file === undefined) return
    const current = yield* Effect.try(() => worktreeRead(file)).pipe(
      Effect.catchAll(() => Effect.succeed("")),
    )
    const verdict = classifyAnswerCompleteness({
      file,
      stateName: rest.state,
      invoker,
      content: current,
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

/** Which declared `on` pattern (if any) each pending change matches — the pure computation `gtd status` reports (both plain and `--json`). `onEdges` is ALREADY RENDERED against `it.vars` (`renderOnEdges`) — the reported pattern is the one a real `gtd step` would match against. */
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

/** The first declared `on` edge that WOULD fire for `gtd next`/`gtd step` right now, for `gtd status` to preview. */
interface NextMatch {
  readonly action: string | undefined
  readonly pattern: string
  readonly target: string
}

/**
 * First declared `on` edge (in declaration order) whose pattern matches the
 * WHOLE pending change list — mirroring `PatternMachine.step`'s own
 * first-match-wins semantics (`matchOn`) exactly, unlike `computeStatusChanges`
 * above which matches each change independently. `null` when no edge matches,
 * covering both a clean tree with no declared `C` row and a dirty tree
 * matching none of the declared patterns.
 *
 * This reports the DECLARED route only: a capped `retry` target may redirect
 * elsewhere at real step time (`applyRetry` in `PatternMachine.ts`), which
 * this does not apply — same pre-retry, pure-over-already-fetched-inputs
 * contract as `computeStatusChanges`.
 */
export const computeNextMatch = (
  onEdges: readonly OnEdge[],
  changes: readonly PendingChange[],
): NextMatch | null => {
  for (const [pattern, target, , action] of onEdges) {
    const parsed = parsePattern(pattern)
    if (parsed !== undefined && matchesPattern(parsed, changes)) return { action, pattern, target }
  }
  return null
}

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

/** Builds `{[key]: value}` for each entry whose value isn't `undefined` — the shared "omit absent optional fields" shape behind both `writeStatusJson` and `writeStatusPlain`. */
const definedFields = (
  entries: readonly (readonly [string, unknown])[],
): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of entries) if (value !== undefined) result[key] = value
  return result
}

/** `gtd status --json`'s `next` key — `null` on no match, else the matched edge's pattern/target plus its `action` when declared. */
const nextField = (
  next: NextMatch | null,
): { action?: string; pattern: string; target: string } | null =>
  next === null
    ? null
    : { ...definedFields([["action", next.action]]), pattern: next.pattern, target: next.target }

/** `gtd status`'s `Next:` line — the plain-text counterpart to `nextField`. */
const nextStatusLine = (next: NextMatch | null): string =>
  next === null
    ? "Next: (no match — nothing would happen)"
    : `Next: ${next.action ?? next.pattern} → ${next.target}`

/** `gtd status`'s `Pending:` block — `(clean)` when nothing is pending, else one indented line per change. */
const pendingStatusLines = (statusChanges: readonly StatusChange[]): string[] =>
  statusChanges.length === 0
    ? ["Pending: (clean)"]
    : [
        "Pending:",
        ...statusChanges.map((c) => `  ${c.status} ${c.path} -> ${c.pattern ?? "(no match)"}`),
      ]

/** `gtd status --json`'s emission — `{state, actor, changes, next, model?, memory?, label?, file?, mode?, cost?, costByModel?, edges?}`. `renderedOn` is the resting state's `on` edges already rendered against `it.vars` (`renderOnEdges`), so the emitted `edges[].pattern` carries the same rendered path as `changes[].pattern`. `next` is ALWAYS present (an object, or `null` on no match) — the headline conclusion, never omit-vs-null, same as `changes`. */
const writeStatusJson = (
  write: (chunk: string) => void,
  rest: ResolvedRest,
  statusChanges: readonly StatusChange[],
  renderedOn: readonly OnEdge[],
  next: NextMatch | null,
  model: string | undefined,
  memory: string | undefined,
  label: string | undefined,
  file: string | undefined,
  cost: number,
  costByModel: readonly ModelCost[],
): void => {
  const edges = toTemplateEdges(renderedOn)
  const hasCost = cost > 0
  write(
    JSON.stringify({
      state: rest.state,
      actor: rest.actor,
      changes: statusChanges,
      next: nextField(next),
      ...definedFields([
        ["model", model],
        ["memory", memory],
        ["label", label],
        ["file", file],
        ["mode", rest.stateDef.mode],
        ["cost", hasCost ? cost : undefined],
        ["costByModel", hasCost ? costByModel : undefined],
        ["edges", edges.length > 0 ? edges : undefined],
      ]),
    }) + "\n",
  )
}

/** `gtd status`'s plain-text emission — `State:`/`Awaits:`/`Label:`/`Model:`/`Memory:`/`File:`/`Mode:`/`Cost:`/`Pending:`/`Next:` lines. */
const writeStatusPlain = (
  write: (chunk: string) => void,
  rest: ResolvedRest,
  statusChanges: readonly StatusChange[],
  next: NextMatch | null,
  model: string | undefined,
  memory: string | undefined,
  label: string | undefined,
  file: string | undefined,
  cost: number,
  costByModel: readonly ModelCost[],
): void => {
  const optional = definedFields([
    ["Label", label],
    ["Model", model],
    ["Memory", memory],
    ["File", file],
    ["Mode", rest.stateDef.mode],
  ])
  const lines = [
    `State: ${rest.state}`,
    `Awaits: ${rest.actor}`,
    ...Object.entries(optional).map(([key, value]) => `${key}: ${value}`),
    ...costStatusLines(cost, costByModel),
    ...pendingStatusLines(statusChanges),
    nextStatusLine(next),
  ]
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
    const { rest, context, renderedOn } = yield* resolveRestContext(git)
    const changes = yield* pendingChanges(git)
    const model = yield* renderModel(rest.stateDef, context)
    const memory = yield* renderMemory(rest.stateDef, context)
    const label = yield* renderLabel(rest.stateDef, context)
    const file = yield* renderFile(rest.stateDef, context)
    const statusChanges = computeStatusChanges(renderedOn, changes)
    const next = computeNextMatch(renderedOn, changes)
    if (json) {
      writeStatusJson(
        write,
        rest,
        statusChanges,
        renderedOn,
        next,
        model,
        memory,
        label,
        file,
        context.processCost,
        context.processCostByModel,
      )
    } else {
      writeStatusPlain(
        write,
        rest,
        statusChanges,
        next,
        model,
        memory,
        label,
        file,
        context.processCost,
        context.processCostByModel,
      )
    }
  })

interface VisualizeOptions {
  readonly port: number
  readonly open: boolean
}

/** Parse a `--port` value: an integer 0–65535, or `undefined` if invalid/absent. */
const parsePort = (value: string | undefined): number | undefined => {
  const n = Number(value)
  return value !== undefined && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : undefined
}

/** Resolve a `--port`/`--port=<n>` argument to its raw value + the index consumed, or `null` if `arg` is not a port option. */
const portArgValue = (
  arg: string,
  rest: readonly string[],
  i: number,
): { value: string | undefined; nextIndex: number } | null => {
  if (arg === "--port") return { value: rest[i + 1], nextIndex: i + 1 }
  if (arg.startsWith("--port=")) return { value: arg.slice("--port=".length), nextIndex: i }
  return null
}

/**
 * Parse `gtd visualize`'s own options from the argv tail (the subcommand token
 * already dropped): `--port <n>`/`--port=<n>`, `--no-open`, and a passthrough
 * `--json`. Returns the options, or an `{ error }` message for an invalid port,
 * an unknown `--` option, or an unexpected positional.
 */
const parseVisualizeOptions = (rest: readonly string[]): VisualizeOptions | { error: string } => {
  let port = 0
  let open = true
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    const portArg = portArgValue(arg, rest, i)
    if (portArg !== null) {
      const parsed = parsePort(portArg.value)
      if (parsed === undefined)
        return {
          error: `gtd visualize: --port must be an integer 0–65535 (got '${portArg.value ?? ""}')`,
        }
      port = parsed
      i = portArg.nextIndex
      continue
    }
    if (arg === "--json") continue
    if (arg === "--no-open") open = false
    else if (arg.startsWith("--"))
      return { error: `gtd: unknown option '${arg}' — see \`gtd --help\`` }
    else return { error: `gtd visualize: unexpected argument '${arg}'` }
  }
  return { port, open }
}

/**
 * Best-effort resolution of the currently-rested state for the viewer's
 * `/state.json` route: prefers the review checkout window's saved head
 * (`REVIEW_HEAD_REF`) over HEAD itself, since `gtd visualize` is dispatched
 * BEFORE the review-window bracket and a request landing mid-window would
 * otherwise read a HEAD that's been temporarily rewound (see
 * `src/ReviewWindow.ts`). Any failure (not a repo, no commits, resolves to
 * the initial state with no process underway) is swallowed to `null` — the
 * browser just hides the panel.
 */
const computeCurrentState = (
  model: VizModel,
): Effect.Effect<CurrentStateModel, Error, GitService | ConfigService | EnvVars> =>
  Effect.gen(function* () {
    const git: GitOperations = yield* GitService
    const config = yield* (yield* ConfigService).load
    const envVars = yield* EnvVars
    const reviewHead = yield* git.readRefOption(REVIEW_HEAD_REF)
    const currentRest = yield* resolveRest(Option.getOrUndefined(reviewHead))
    const run = yield* computeProcessRun(git, currentRest.def)
    const changes = yield* pendingChanges(git)
    const vars = resolveVars(config.workflowVars, config.rcVars, run.entryVars, envVars.all)
    const renderedOn = yield* renderOnEdgesOrFail(currentRest.stateDef.on, vars)
    const group = model.states.find((s) => s.name === currentRest.state)?.group
    return buildCurrentStateModel(currentRest, changes, renderedOn, group)
  })

/**
 * `gtd visualize`: serve an interactive diagram of the ACTIVE workflow on a
 * local HTTP server (see `src/Visualize.ts`). Dispatched early (like `lsp`/
 * `init`) — it reads the config but never touches git, HEAD, or the review
 * window ITSELF (though its `/state.json` route best-effort reads git state
 * per request, see `computeCurrentState`) — and parses its OWN options
 * (`--port`, `--no-open`), since the global unknown-option check does not
 * know them. `--json` prints the model and exits without starting a server
 * (the testable path; live state is a server-only concern, so `--json`'s
 * shape is unchanged).
 */
const runVisualizeCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, GitService | ConfigService | EnvVars> =>
  Effect.gen(function* () {
    const tokens = argv.slice(2)
    const subIdx = tokens.indexOf("visualize")
    const rest = subIdx >= 0 ? [...tokens.slice(0, subIdx), ...tokens.slice(subIdx + 1)] : tokens
    const opts = parseVisualizeOptions(rest)
    if ("error" in opts) return yield* Effect.fail(new Error(opts.error))

    const config = yield* (yield* ConfigService).load
    const model = buildVizModel(config.workflow, config.machineTree, {
      ...config.workflowVars,
      ...config.rcVars,
    })

    if (json) {
      write(JSON.stringify(model, null, 2) + "\n")
      return
    }

    const runtime = yield* Effect.runtime<GitService | ConfigService | EnvVars>()
    const resolveCurrent = () =>
      Runtime.runPromise(runtime)(computeCurrentState(model).pipe(Effect.either)).then(
        Either.getOrNull,
      )

    const { server, url } = yield* Effect.tryPromise({
      try: () => startVizServer(model, opts.port, "127.0.0.1", resolveCurrent),
      catch: (e) =>
        new Error(
          `gtd visualize: could not start server: ${e instanceof Error ? e.message : String(e)}`,
        ),
    })
    write(`gtd visualize running at ${url} — Ctrl-C to stop\n`)
    if (opts.open) openInBrowser(url)
    // Block until the process is interrupted (Ctrl-C); always close the server.
    yield* Effect.never.pipe(Effect.ensuring(Effect.sync(() => server.close())))
  })

const KNOWN_SUBCOMMANDS = ["step", "abandon", "restore", "next", "status", "validate"] as const
type KnownSubcommand = (typeof KNOWN_SUBCOMMANDS)[number]

/**
 * The two named commands the generic `--entry` mechanism replaced (see
 * `runEntryCommand`) — no fallback, so `gtd review`/`gtd fix` must fail with a
 * message pointing at the replacement rather than the generic "unknown
 * command" (see `requireKnownSubcommand`). Illustrated with the bundled
 * unified template's own entry-flagged state names (`review-gate.check`/
 * `fix-precheck`) since gtd itself has no opinion on any workflow's state
 * names — a custom workflow names its own.
 */
const REMOVED_SUBCOMMANDS: Record<string, string> = {
  review:
    "gtd: `gtd review <commitish>` is gone — this workflow's own state names " +
    "aren't known to gtd; run `gtd step <actor> --entry <review-state> " +
    "--var <name>=<value> ...` instead (e.g. " +
    "`gtd step human --entry review-gate.check` for the bundled unified template)",
  fix:
    "gtd: `gtd fix` is gone — this workflow's own state names aren't known to " +
    "gtd; run `gtd step <actor> --entry <fix-state>` instead (e.g. " +
    "`gtd step human --entry fix-precheck` for the bundled unified template)",
}

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
  const removedMessage = REMOVED_SUBCOMMANDS[sub]
  if (removedMessage !== undefined) {
    return Effect.fail(new Error(removedMessage))
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
 * cwd→home chain. The one
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

/** Dispatches to the named `run*Command` handler for every known subcommand. `entryFlags` is only consulted by `step` (see `runStepCommand`) — every other subcommand ignores it, since `--entry`/`--var` are meaningless anywhere else (`parseEntryFlags` already rejects that combination before dispatch is reached). */
const dispatchKnownSubcommand = (
  sub: KnownSubcommand,
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
  cost: number | undefined,
  model: string | undefined,
  entryFlags: { readonly entry: string | undefined; readonly vars: Record<string, string> },
): Effect.Effect<void, Error, ProgramRequirements> => {
  switch (sub) {
    case "step":
      return runStepCommand(argv, json, write, cost, model, entryFlags)
    case "abandon":
      return runAbandonCommand(argv, json, write)
    case "restore":
      return runRestoreCommand(argv, json, write)
    case "next":
      return runNextCommand(json, write)
    case "status":
      return runStatusCommand(argv, json, write)
    case "validate":
      return runValidateCommand(argv, json, write)
  }
}

/**
 * Runs `command` inside the bracket every state-touching subcommand shares:
 * the repo-root guard, then close-any-open-review-window before the command
 * sees HEAD, then re-arm it afterward whether `command` succeeded or refused
 * (see `closeReviewWindow`/`openReviewWindow`). Shared by the normal
 * known-subcommand dispatch and the subcommand-less `gtd --entry <state>`
 * short form in `makeProgram`, so both open/close the window identically.
 */
const runInReviewWindowBracket = (
  git: GitOperations,
  fs: FileSystem.FileSystem,
  command: Effect.Effect<void, Error, ProgramRequirements>,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
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
    const outcome = yield* Effect.either(command)
    const rearm = yield* Effect.either(openReviewWindow)
    if (Either.isLeft(outcome)) return yield* Effect.fail(outcome.left)
    if (Either.isLeft(rearm)) return yield* Effect.fail(rearm.left)
  })

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
 * v3 command surface: `step <actor>` / `next` / `status` / `validate` (see
 * `src/Edge.ts`), plus `lsp` and `init` — both dispatched before the
 * config-reading path since neither needs to touch the config. `step
 * <actor> --entry <state>` (and its subcommand-less short form `gtd --entry
 * <state>`, actor defaulting to `human`) starts a brand-new process at any
 * declared, non-commit state — the generic mechanism that replaced the old
 * named `review`/`fix` commands (see `runEntryCommand`; `gtd review`/`gtd
 * fix` now fail with a message pointing at the replacement, `REMOVED_SUBCOMMANDS`).
 * Bare `gtd` with no `--entry` present, or an unknown subcommand, is a usage
 * error. Shared setup (argv parsing, the repo-root guard) lives here; each
 * subcommand's own logic is a named `run*Command` function above.
 */
export function makeProgram(
  opts: RunOptions = {},
): Effect.Effect<void, Error, ProgramRequirements> {
  const argv = opts.argv ?? process.argv
  const write = opts.write ?? ((chunk: string) => process.stdout.write(chunk))
  const json = argv.includes("--json")
  // Skip any index `--entry`/`--var` consumed as a VALUE (e.g. `--entry
  // review-gate.check`'s `review-gate.check`, which carries no `--` prefix of
  // its own) — otherwise it reads as a stray extra positional (see
  // `takeFlagValues`/`flagConsumedIndices`).
  const consumedFlagIndices = flagConsumedIndices(argv)
  const positional = argv
    .map((a, i) => ({ a, i }))
    .slice(2)
    .find(({ a, i }) => !a.startsWith("--") && !consumedFlagIndices.has(i))?.a

  // fallow-ignore-next-line complexity
  return Effect.gen(function* () {
    if (runVersionOrHelp(argv, write)) return

    // `visualize` is dispatched BEFORE the global option check (like lsp/init):
    // it reads config but touches no git/HEAD/review-window, and it owns
    // `--port`/`--no-open`, which the global check does not know.
    if (positional === "visualize") {
      return yield* runVisualizeCommand(argv, json, write)
    }

    // Reject unknown `--` options up front: a typo like `--jsn` must not
    // silently degrade to plain-text mode. `--json`, `--cost=<n>`, `--entry`,
    // and `--var` are the only long options; `--version`/`--help` (and their
    // short forms) short-circuited above. A bare `--cost`/`--entry` (no `=`,
    // no space-separated value) is left for `parseCostFlag`/`parseEntryFlags`
    // to reject with a value-specific message.
    const unknownOption = argv.slice(2).find(
      // fallow-ignore-next-line complexity
      (a) =>
        a.startsWith("--") &&
        a !== "--json" &&
        a !== "--cost" &&
        a !== "--model" &&
        a !== ENTRY_FLAG &&
        a !== VAR_FLAG &&
        !a.startsWith(COST_FLAG) &&
        !a.startsWith(MODEL_FLAG) &&
        !a.startsWith(`${ENTRY_FLAG}=`) &&
        !a.startsWith(`${VAR_FLAG}=`),
    )
    if (unknownOption !== undefined) {
      return yield* Effect.fail(
        new Error(`gtd: unknown option '${unknownOption}' — see \`gtd --help\``),
      )
    }

    // `--cost`/`--model` record the just-finished invocation's token cost and
    // model as a `Gtd-Cost:` trailer on the turn commit (see `parseStepFlags`).
    const { cost, model } = yield* parseStepFlags(argv, positional)
    // `--entry`/`--var` start a brand-new process at a declared state instead
    // of stepping the resting one (see `parseEntryFlags`/`runEntryCommand`).
    const entryFlags = yield* parseEntryFlags(argv, positional)
    if (entryFlags.entry !== undefined && (cost !== undefined || model !== undefined)) {
      return yield* Effect.fail(
        new Error(
          "gtd: --cost/--model cannot be combined with --entry — an entry is not a metered agent turn",
        ),
      )
    }

    if (positional === "lsp") {
      return yield* runLspCommand(argv, json)
    }

    if (positional === "init") {
      return yield* runInitCommand(argv, json, write)
    }

    if (positional === undefined && entryFlags.entry !== undefined) {
      // The subcommand-less short form: `gtd --entry <state> [--var ...]`,
      // equivalent to `gtd step human --entry <state> ...`.
      const git = yield* GitService
      const fs = yield* FileSystem.FileSystem
      return yield* runInReviewWindowBracket(
        git,
        fs,
        runEntryCommand(
          "human",
          entryFlags.entry,
          entryFlags.vars,
          json,
          write,
          `gtd --entry ${entryFlags.entry}`,
        ),
      )
    }

    const sub = yield* requireKnownSubcommand(positional, json, write)

    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    yield* runInReviewWindowBracket(
      git,
      fs,
      dispatchKnownSubcommand(sub, argv, json, write, cost, model, entryFlags),
    )
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
