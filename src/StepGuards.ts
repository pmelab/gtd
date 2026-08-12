import { Effect } from "effect"
import { RepoFiles } from "./RepoFiles.js"
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
 * The step CAPTURE guards: edge-side conditions that refuse a `gtd land`
 * before it can commit — never engine concerns (`src/PatternMachine.ts`'s
 * `step` never sees any of this; a state's declared `on` pattern is the only
 * thing that decides WHERE a step lands, these guards only decide WHETHER it
 * may land at all). One registry (`stepGuards`) replaces hand-copied
 * `enforce*` blocks that used to live in `src/program.ts`:
 *
 * - **review-signoff** — at a review window's `mode: review` gate, refuse a
 *   deleted doc or an unfinished tick-only pass with no comment.
 * - **feedback-progress** — at a `requireProgress` state, refuse deleting the
 *   instructions file without doing (or explicitly declining) the work.
 * - **answer-completeness** — at an `answerGate` `mode: qa` state, refuse
 *   while any open question is unanswered.
 *
 * `enforceStepGuards` samples the committed/working bytes ONCE (cached), then
 * runs every applicable guard's `check` (reads) against that one sample.
 * There is no write phase here anymore: a `format:` command (a mode's own
 * whitespace/wrapping/ordering normalization) is emitted into a step's bash
 * script for an EXTERNAL driver to run — it may run before or after this
 * process reads the file, or not at all before the CLI decides. That is
 * sound only because a `format:` command is NORMALIZATION-ONLY and must
 * NEVER change what a guard would decide: this repo's guards judge whichever
 * bytes are currently on disk (pre-format or post-format, indistinguishable
 * to a guard that only cares about content, not incidental formatting), so
 * the CLI's ONE decision — made here, now, against whatever the working tree
 * currently holds — can never be invalidated by a formatter running later. A
 * `format:` command that changes a guard's verdict (e.g. one that also
 * mutates checkbox state, or strips content) would be a mode-author bug, not
 * a gtd concern; gtd enforces nothing about a mode's `format:` beyond "it
 * runs as part of the step script."
 */

export type GuardRequirements = RepoFiles

/** A guard's verdict: `undefined` allows the step; a string is the refusal reason (the `gtd land: ` prefix is added once, by `enforceStepGuards`). */
export type Refusal = string | undefined

/** Everything a guard's `check` needs — assembled once per `enforceStepGuards` call, shared by every applicable guard. */
export interface GuardContext {
  readonly rest: ResolvedRest
  /** The rest state's rendered `file:` — non-optional, since `enforceStepGuards` already returned early when the state declares none. */
  readonly file: string
  readonly changes: readonly PendingChange[]
  /** True when this step's changes delete `file`. */
  readonly fileDeleted: boolean
  /**
   * True when this step touches a path that is neither gtd plumbing (`.gtd/`)
   * nor the state's OWN `file:` — i.e. the human edited something real, which
   * every guard here reads as "a comment"/"the work was done".
   *
   * Excluding `file` by exact path is load-bearing for a state whose `file:` is
   * repointed OUTSIDE `.gtd/` (an ordinary `vars:` override, e.g. `REVIEW.md`
   * at the repo root): the reviewer's own edit to the review doc would
   * otherwise count as a code edit, so the sign-off guard took the
   * it-is-a-comment branch on every pass and its unticked check was
   * unreachable. Same shape as the bug in `deciding`'s check script (issue
   * #128), which also assumed every steering file lives under `.gtd/`.
   */
  readonly hasCodeChange: boolean
  readonly template: TemplateContext
  /**
   * `file`'s contents at the PRE-TURN head (before this step), `undefined` if
   * absent there. Cached — evaluated once per `enforceStepGuards` call.
   *
   * That head is real `HEAD` normally, but the review checkout window's saved
   * head (`Rest.windowHead`) while a window is open: the window has rewound
   * real HEAD to the review base, where a file the process itself added does
   * not exist yet. Reading `HEAD` there made `original` empty for every review
   * doc, so the sign-off guard's "only checkbox flips" comparison always found
   * a difference, took the it's-a-comment branch, and never reached the
   * unticked count — the tick-completeness gate was inert for exactly the
   * situation it exists for.
   */
  readonly head: Effect.Effect<string | undefined, Error>
  /** `file`'s CURRENT working-tree contents — whatever is on disk right now, pre- or post- an external driver's own `format:` run. Cached. */
  readonly worktree: Effect.Effect<string | undefined, Error>
}

export interface StepGuard {
  readonly name: string
  /** Pure — decided from the definition/state alone, before any IO is paid for. */
  readonly appliesTo: (rest: ResolvedRest) => boolean
  /** Decide allow (`undefined`) or refuse (a reason string). */
  readonly check: (ctx: GuardContext) => Effect.Effect<Refusal, Error, GuardRequirements>
}

/**
 * True when `changes` deletes `file` — the one question BOTH this registry's
 * `GuardContext.fileDeleted` and `program.ts`'s `steeringModeSteps` ask about a
 * state's `file:`, so they ask it in exactly one place. A deletion is a
 * legitimate step outcome at some states (a review sign-off's bare REVIEW.md
 * deletion) and a refusal at others (see `reviewSignoffGuard`), but either way
 * there is no file left to format or validate.
 */
export const deletesFile = (changes: readonly PendingChange[], file: string): boolean =>
  changes.some((c) => c.path === file && c.status === "D")

/** Normalize every markdown checkbox to a single placeholder so a pure `[ ]`→`[x]` tick is invisible to a text comparison; any surviving difference is a human note. */
const normalizeCheckboxes = (content: string): string => content.replace(/\[[ xX]\]/g, "[_]")

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

/** The three step-capture guards, in EVALUATION order — message precedence when two would fire is observable, so this order is the contract (matches the old hand-copied call order, minus the now-removed steering-file guard). */
export const stepGuards: readonly StepGuard[] = [
  reviewSignoffGuard,
  feedbackProgressGuard,
  answerCompletenessGuard,
]

/**
 * The `gtd land` capture gate: run every guard the resolved rest's state
 * applies to against ONE sample of the current committed/working bytes — see
 * the module docstring — and fail with the first refusal's reason, prefixed
 * `gtd land: ` (the one place that prefix, and the `cliErrorLine`
 * `/^gtd[: ]/` contract, is satisfied). A no-op for a squash/no-op decision, an
 * ATTEMPT commit (`input.attempt` — see its own doc comment), a state with no
 * `file:`, or a state no guard applies to.
 */
export const enforceStepGuards = (input: {
  readonly rest: ResolvedRest
  readonly context: TemplateContext
  /** The state's ALREADY-RENDERED `file:` — `Rest.hints.file`, rendered once when the snapshot was built rather than re-rendered per guard. */
  readonly file: string | undefined
  readonly changes: readonly PendingChange[]
  /** `Rest.windowHead` — the open review window's saved head, the ref `head` reads `file` at. `undefined` (real `HEAD`) when no window is open. */
  readonly windowHead: string | undefined
  readonly kind: ExecutableDecision["kind"]
  /**
   * True for an ATTEMPT commit (`PatternMachine.StepCommit.attempt`) — a
   * fruitless `prompt`-state dispatch whose diff is EMPTY by construction.
   * There is nothing for any guard to guard: a deletion/tick/answer check can
   * only ever read "unchanged", and running a mode's `format:` ahead of the
   * commit (as an ordinary step's script does) could dirty the tree and turn
   * an "empty" attempt non-empty, breaking the derivation `stalledAt` relies
   * on (see `Edge.ts`). Bypasses every guard exactly like a squash/no-op
   * decision.
   */
  readonly attempt: boolean
}): Effect.Effect<void, Error, GuardRequirements> =>
  Effect.gen(function* () {
    if (input.kind !== "commit" || input.attempt) return
    const file = input.file
    if (file === undefined) return
    const applicable = stepGuards.filter((g) => g.appliesTo(input.rest))
    if (applicable.length === 0) return

    const fileDeleted = deletesFile(input.changes, file)
    const hasCodeChange = input.changes.some((c) => !c.path.startsWith(".gtd/") && c.path !== file)

    const base = {
      rest: input.rest,
      file,
      changes: input.changes,
      fileDeleted,
      hasCodeChange,
      template: input.context,
    }

    const files = yield* RepoFiles
    const head = yield* Effect.cached(files.committed(file, input.windowHead))
    const worktree = yield* Effect.cached(Effect.try(() => files.working(file)))
    const ctx: GuardContext = { ...base, head, worktree }

    for (const g of applicable) {
      const refusal = yield* g.check(ctx)
      if (refusal !== undefined) {
        return yield* Effect.fail(new Error(`gtd land: ${refusal}`))
      }
    }
  })
