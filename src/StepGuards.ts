import { Effect } from "effect"
import { CommandRunner } from "./CommandRunner.js"
import { RepoFiles } from "./RepoFiles.js"
import {
  formatSteeringFile,
  resolveSteeringMode,
  unknownModeMessage,
  validateSteeringFile,
} from "./SteeringMode.js"
import {
  isAnswerGateState,
  isReviewWindowState,
  isRequireProgressState,
  type PendingChange,
} from "./PatternMachine.js"
import { unansweredQuestions } from "./OpenQuestions.js"
import { untickedFiles } from "./ReviewDoc.js"
import type { ExecutableDecision, ResolvedRest } from "./Edge.js"
import type { TemplateContext } from "./PatternTemplates.js"

/**
 * The step CAPTURE guards: edge-side conditions that refuse a `gtd step`
 * before it can commit — never engine concerns (`src/PatternMachine.ts`'s
 * `step` never sees any of this; a state's declared `on` pattern is the only
 * thing that decides WHERE a step lands, these guards only decide WHETHER it
 * may land at all). One registry (`stepGuards`) replaces four hand-copied
 * `enforce*` blocks that used to live in `src/program.ts`:
 *
 * - **steering-file** — format then validate a state's `file:`/`mode:` pair,
 *   refusing an invalid result (`src/SteeringMode.ts`).
 * - **review-signoff** — at a review window's `mode: review` gate, refuse a
 *   deleted doc or an unfinished tick-only pass with no comment.
 * - **feedback-progress** — at a `requireProgress` state, refuse deleting the
 *   instructions file without doing (or explicitly declining) the work.
 * - **answer-completeness** — at an `answerGate` `mode: qa` state, refuse
 *   while any open question is unanswered.
 *
 * `enforceStepGuards` runs every APPLICABLE guard's `prepare` (writes — only
 * the steering-file guard's format command has one) to completion BEFORE
 * sampling the committed/working bytes ONCE (cached), then runs every
 * `check` (reads) against that one sample — so a `format:` command's rewrite
 * is visible to every guard, including one it wasn't written for, and no
 * guard ever judges half-formatted bytes.
 */

export type GuardRequirements = RepoFiles | CommandRunner

/** A guard's verdict: `undefined` allows the step; a string is the refusal reason (the `gtd step <invoker>: ` prefix is added once, by `enforceStepGuards`). */
export type Refusal = string | undefined

/** Everything a guard's `check` (and the steering-file guard's `prepare`) needs — assembled once per `enforceStepGuards` call, shared by every applicable guard. */
export interface GuardContext {
  readonly rest: ResolvedRest
  /** The rest state's rendered `file:` — non-optional, since `enforceStepGuards` already returned early when the state declares none. */
  readonly file: string
  readonly changes: readonly PendingChange[]
  /** True when this step's changes delete `file`. */
  readonly fileDeleted: boolean
  /** True when this step touches a path outside `.gtd/`. */
  readonly hasCodeChange: boolean
  readonly template: TemplateContext
  /** `file`'s contents at HEAD (before this step), `undefined` if absent there. Cached — evaluated once per `enforceStepGuards` call. */
  readonly head: Effect.Effect<string | undefined, Error>
  /** `file`'s WORKING-TREE contents, sampled AFTER every applicable guard's `prepare` has run — so every `check` sees post-format bytes. Cached. */
  readonly worktree: Effect.Effect<string | undefined, Error>
}

export interface StepGuard {
  readonly name: string
  /** Pure — decided from the definition/state alone, before any IO is paid for. */
  readonly appliesTo: (rest: ResolvedRest) => boolean
  /** The WRITE phase (only the steering-file guard has one): runs for every applicable guard, in order, before any guard's `check`. */
  readonly prepare?: (
    ctx: Omit<GuardContext, "head" | "worktree">,
  ) => Effect.Effect<void, Error, GuardRequirements>
  /** The READ phase: decide allow (`undefined`) or refuse (a reason string). */
  readonly check: (ctx: GuardContext) => Effect.Effect<Refusal, Error, GuardRequirements>
}

/** Normalize every markdown checkbox to a single placeholder so a pure `[ ]`→`[x]` tick is invisible to a text comparison; any surviving difference is a human note. */
const normalizeCheckboxes = (content: string): string => content.replace(/\[[ xX]\]/g, "[_]")

const steeringFileGuard: StepGuard = {
  name: "steering-file",
  appliesTo: (rest) => rest.stateDef.mode !== undefined,
  prepare: (ctx) =>
    Effect.gen(function* () {
      const mode = ctx.rest.stateDef.mode!
      const resolved = resolveSteeringMode(ctx.rest.def, mode)
      if (resolved === undefined) {
        // `validateDefinition` rejects an unresolvable `mode:` at load time —
        // defensive, not a reachable config path.
        return yield* Effect.fail(new Error(unknownModeMessage(ctx.rest.def, ctx.rest.state, mode)))
      }
      const files = yield* RepoFiles
      if (files.working(ctx.file) === undefined) return // a deletion — nothing to format
      yield* formatSteeringFile(resolved, ctx.file, ctx.template)
    }),
  check: (ctx) =>
    Effect.gen(function* () {
      const mode = ctx.rest.stateDef.mode!
      const resolved = resolveSteeringMode(ctx.rest.def, mode)
      if (resolved === undefined) return undefined // `prepare` already failed this path
      const current = yield* ctx.worktree
      if (current === undefined) return undefined // a deletion — nothing to validate
      const errors = yield* validateSteeringFile(resolved, ctx.file, current, ctx.template)
      if (errors.length === 0) return undefined
      return `${ctx.file} is not valid at "${ctx.rest.state}" — fix these before stepping:\n${errors
        .map((e) => `  - ${e}`)
        .join("\n")}`
    }),
}

/** The `mode:` name of gtd's built-in REVIEW.md checkbox validator — the only mode the sign-off guard understands. */
const REVIEW_MODE = "review"

const reviewSignoffGuard: StepGuard = {
  name: "review-signoff",
  appliesTo: (rest) =>
    isReviewWindowState(rest.def, rest.state) && rest.stateDef.mode === REVIEW_MODE,
  check: (ctx) =>
    Effect.gen(function* () {
      if (ctx.fileDeleted) {
        return `${ctx.file} was deleted at "${ctx.rest.state}" — restore it and tick the boxes to sign off, or leave a note (or edit code) to request changes.`
      }
      // A comment — a code edit, or a note (the doc differs beyond a checkbox
      // flip) — is always a feedback round; let it commit.
      if (ctx.hasCodeChange) return undefined
      const original = (yield* ctx.head) ?? ""
      const current = (yield* ctx.worktree) ?? ""
      if (normalizeCheckboxes(original) !== normalizeCheckboxes(current)) return undefined
      // Only checkbox flips, no comment: a sign-off needs EVERY file pointer ticked.
      const unticked = untickedFiles(current).length
      if (unticked > 0) {
        return `${unticked} review item(s) still unticked and no comment at "${ctx.rest.state}" — finish reviewing (tick every box), or leave a note (or edit code) to request a change.`
      }
      return undefined
    }),
}

/** The one-line marker `feedback-collecting` writes when a review round left nothing actionable — the ONLY content that lets a `requireProgress` state's instructions file be deleted without a code change. */
const NOTHING_ACTIONABLE_SENTINEL = "NOTHING ACTIONABLE"

const feedbackProgressGuard: StepGuard = {
  name: "feedback-progress",
  appliesTo: (rest) => isRequireProgressState(rest.def, rest.state),
  check: (ctx) =>
    Effect.gen(function* () {
      if (!ctx.fileDeleted) return undefined
      if (ctx.hasCodeChange) return undefined
      const deletedContent = (yield* ctx.head) ?? ""
      if (deletedContent.trim().startsWith(NOTHING_ACTIONABLE_SENTINEL)) return undefined
      return `${ctx.file} was deleted at "${ctx.rest.state}" without addressing its instructions — implement the changes it lists (then delete it), don't just remove the file.`
    }),
}

/** The `mode:` name of gtd's built-in open-questions checkbox format — the only mode the answer-completeness guard acts on. */
const QA_MODE = "qa"

const answerCompletenessGuard: StepGuard = {
  name: "answer-completeness",
  appliesTo: (rest) => isAnswerGateState(rest.def, rest.state) && rest.stateDef.mode === QA_MODE,
  check: (ctx) =>
    Effect.gen(function* () {
      const current = (yield* ctx.worktree) ?? ""
      const unanswered = unansweredQuestions(current)
      if (unanswered.length === 0) return undefined
      const list = unanswered.map((q) => `  - ${q.question}`).join("\n")
      return `${unanswered.length} open question(s) in ${ctx.file} not answered at "${ctx.rest.state}" — tick exactly one option per question (or delete a question you don't want to answer, or delete the whole "## Open Questions" section to accept the plan as-is):\n${list}`
    }),
}

/** The four step-capture guards, in EVALUATION order — message precedence when two would fire is observable, so this order is the contract (matches the old hand-copied call order). */
export const stepGuards: readonly StepGuard[] = [
  steeringFileGuard,
  reviewSignoffGuard,
  feedbackProgressGuard,
  answerCompletenessGuard,
]

/**
 * The `gtd step` capture gate: run every guard the resolved rest's state
 * applies to, formatting (write phase) before validating (read phase) — see
 * the module docstring — and fail with the first refusal's reason, prefixed
 * `gtd step <invoker>: ` (the one place that prefix, and the `cliErrorLine`
 * `/^gtd[: ]/` contract, is satisfied). A no-op for a squash/no-op decision, a
 * state with no `file:`, or a state no guard applies to.
 */
export const enforceStepGuards = (input: {
  readonly rest: ResolvedRest
  readonly context: TemplateContext
  /** The state's ALREADY-RENDERED `file:` — `Rest.hints.file`, rendered once when the snapshot was built rather than re-rendered per guard. */
  readonly file: string | undefined
  readonly changes: readonly PendingChange[]
  readonly invoker: string
  readonly kind: ExecutableDecision["kind"]
}): Effect.Effect<void, Error, GuardRequirements> =>
  Effect.gen(function* () {
    if (input.kind !== "commit") return
    const file = input.file
    if (file === undefined) return
    const applicable = stepGuards.filter((g) => g.appliesTo(input.rest))
    if (applicable.length === 0) return

    const fileDeleted = input.changes.some((c) => c.path === file && c.status === "D")
    const hasCodeChange = input.changes.some((c) => !c.path.startsWith(".gtd/"))

    const base = {
      rest: input.rest,
      file,
      changes: input.changes,
      fileDeleted,
      hasCodeChange,
      template: input.context,
    }

    for (const g of applicable) {
      if (g.prepare !== undefined) yield* g.prepare(base)
    }

    const files = yield* RepoFiles
    const head = yield* Effect.cached(files.committed(file))
    const worktree = yield* Effect.cached(Effect.try(() => files.working(file)))
    const ctx: GuardContext = { ...base, head, worktree }

    for (const g of applicable) {
      const refusal = yield* g.check(ctx)
      if (refusal !== undefined) {
        return yield* Effect.fail(new Error(`gtd step ${input.invoker}: ${refusal}`))
      }
    }
  })

/** Format the resolved state's steering file (in place) then validate it — `gtd validate`'s shape. */
export interface SteeringCheck {
  /** The rendered `file:` path, or `undefined` when the state declares no `file:`/`mode:`. */
  readonly file: string | undefined
  /** True when a steering file was actually present and got formatted + validated (false when the state declares none, or the file is absent — a deletion). */
  readonly present: boolean
  /** The parser findings (empty when `present` is false). */
  readonly errors: readonly string[]
}

/**
 * `gtd validate`'s shared evaluation: format the resolved rest's steering
 * file in place, then validate its formatted contents — the SAME
 * format-then-validate pair the `steering-file` guard's `prepare`/`check`
 * split runs, so both format and check the same way (an agent's fresh draft
 * and a human's edit are treated alike). `present` is false — and nothing is
 * formatted or validated — when the state declares no steering file, or the
 * file is absent (e.g. a human deleted `.gtd/REVIEW.md` to approve).
 */
export const checkSteeringFile = (
  rest: ResolvedRest,
  context: TemplateContext,
  file: string | undefined,
): Effect.Effect<SteeringCheck, Error, GuardRequirements> =>
  Effect.gen(function* () {
    const mode = rest.stateDef.mode
    if (file === undefined || mode === undefined) return { file, present: false, errors: [] }
    const files = yield* RepoFiles
    if (files.working(file) === undefined) return { file, present: false, errors: [] }
    const resolved = resolveSteeringMode(rest.def, mode)
    if (resolved === undefined) {
      return yield* Effect.fail(new Error(unknownModeMessage(rest.def, rest.state, mode)))
    }
    yield* formatSteeringFile(resolved, file, context)
    const content = files.working(file) ?? ""
    const errors = yield* validateSteeringFile(resolved, file, content, context)
    return { file, present: true, errors }
  })
