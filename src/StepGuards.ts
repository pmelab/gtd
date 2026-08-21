import { Effect } from "effect"
import { RepoFiles } from "./RepoFiles.js"
import { GitService } from "./Git.js"
import { pathspec } from "./GitScript.js"
import {
  isAnswerGateState,
  isReviewWindowState,
  isRequireProgressState,
  isRequireRevertState,
  STATE_DIR,
  type PendingChange,
} from "./PatternMachine.js"
import { unansweredQuestions } from "./OpenQuestions.js"
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
 * - **review-doc** — at a review window's `mode: review` gate, refuse a
 *   deleted review doc — the review record must survive the step. A tick only
 *   records that the reviewer has read a hunk; it never gates a land. (Sign-off
 *   itself is decided elsewhere, by `unified.yaml`'s `deciding` script — no
 *   guard in this registry has anything to do with it.)
 * - **feedback-progress** — at a `requireProgress` state, refuse deleting the
 *   instructions file without doing (or explicitly declining) the work.
 * - **answer-completeness** — at an `answerGate` `mode: qa` state, refuse
 *   while any open question is unanswered.
 * - **require-revert** — at a `requireRevert` state, refuse while the human's
 *   review-round commit's own paths still differ from the review base's
 *   parent, i.e. a `git apply -R` (or hand-revert) that hasn't actually taken.
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

export type GuardRequirements = RepoFiles | GitService

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
   * True when this step touches a path outside gtd's plumbing directory
   * (`STATE_DIR`, `.gtd`) — i.e. the human edited something real, which every
   * guard here reads as "a comment"/"the work was done". Every state's `file:`
   * is compiled under `STATE_DIR` too (`PatternConfig.ts`'s `stateFile`
   * compiler), so excluding plumbing already excludes the state's own file —
   * there is no separate exact-path exemption to maintain here.
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
   * not exist yet. Any guard that runs at a `reviewWindow: true` state MUST
   * read this field rather than reach for real `HEAD` some other way, or its
   * "pre-turn copy" would come back empty for every file the review turn
   * itself wrote.
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
 * deletion) and a refusal at others (see `reviewDocGuard`), but either way
 * there is no file left to format or validate. `steeringModeSteps` widens this
 * same "nothing to format" idea one step further, to a file that was never
 * written at all (not deleted this step, just absent) — that's a separate
 * `RepoFiles.working` check there, not a change to this function or to
 * `fileDeleted`'s semantics here.
 */
export const deletesFile = (changes: readonly PendingChange[], file: string): boolean =>
  changes.some((c) => c.path === file && c.status === "D")

/**
 * True when `path` sits inside gtd's plumbing directory (`STATE_DIR`, `.gtd`)
 * — an exact match on the bare directory path itself, or prefixed by
 * `STATE_DIR + "/"`. The exact-match-or-separator shape matters: a naive
 * `path.startsWith(STATE_DIR)` would also swallow a sibling `.gtd-backup/`.
 */
const isPlumbingPath = (path: string): boolean =>
  path === STATE_DIR || path.startsWith(`${STATE_DIR}/`)

/**
 * True when `path` is a real code path — outside gtd's plumbing directory.
 * Every state's `file:` is compiled under `STATE_DIR` too (`PatternConfig.ts`'s
 * `stateFile` compiler), so this plain negation already excludes a state's own
 * steering file with no separate exact-path exemption needed. The one "did a
 * human touch something real" predicate shared by `enforceStepGuards`'s own
 * `hasCodeChange` and the require-revert guard's residue scoping, so the rule
 * is declared exactly once.
 */
const isCodePath = (path: string): boolean => !isPlumbingPath(path)

/** The `mode:` name of gtd's built-in REVIEW.md checkbox format — the only mode the review-doc guard understands. */
const REVIEW_MODE = "review"

const reviewDocGuard: StepGuard = {
  name: "review-doc",
  appliesTo: (rest) =>
    isReviewWindowState(rest.def, rest.state) && rest.stateDef.mode === REVIEW_MODE,
  check: (ctx) =>
    Effect.succeed(
      ctx.fileDeleted
        ? `${ctx.file} was deleted at "${ctx.rest.state}" — restore it, or leave a note (or edit code) to request changes.`
        : undefined,
    ),
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

/**
 * The require-revert guard's three properties, each the difference between a
 * real guard and an inert or permanently-refusing one:
 *
 * - **Scoped to the human's commit's own paths**, not "everything
 *   non-steering": `build.review.collecting` writes `requirementsFile`
 *   between `reviewBase` and `re-unwind`, and that file is var-configurable
 *   to the repo ROOT — so an unscoped "any non-`.gtd/` difference vs `base`"
 *   test refuses every single round.
 * - **Comparison direction**: the paths must MATCH `base` (the review base's
 *   parent), never merely differ from `reviewBase`. "Does the human's version
 *   survive?" is the inert form — on a `text=auto` repo a committed-blob-vs-
 *   worktree byte comparison never matches, so the guard would allow
 *   everything. `changedPaths` borrows git's own filter-correct hashing
 *   (`git hash-object` WITH clean filters) and both git tiers implement it as
 *   base-tree-vs-worktree by content, so the fake and a real repo answer
 *   alike. A false positive here is a refusal (loud); a false negative would
 *   be silence.
 * - **Exempting the review file**, which needs no exact-path carve-out any
 *   more: every state's `file:` compiles under `STATE_DIR` (`.gtd`) now (see
 *   `PatternConfig.ts`'s `stateFile` compiler), so `isCodePath`'s plain
 *   plumbing-directory exclusion already covers it — a review-round commit's
 *   deletion of the review file is plumbing, not residue, with no separate
 *   check needed.
 */
const requireRevertGuard: StepGuard = {
  name: "require-revert",
  appliesTo: (rest) => isRequireRevertState(rest.def, rest.state),
  check: (ctx) =>
    Effect.gen(function* () {
      const rb = ctx.template.reviewBase
      if (rb === "" || rb === ctx.template.startCommit) {
        return `"${ctx.rest.state}" has no identifiable review round to check (reviewBase is unset) — the revert cannot be established.`
      }
      const git = yield* GitService
      const base = `${rb}~1`
      const touched = (yield* git.commitHistory(base, rb))[0]?.touched ?? []
      const scoped = touched.filter((path) => isCodePath(path))
      if (scoped.length === 0) return undefined
      const residue = (yield* git.changedPaths(base))
        .filter((c) => scoped.includes(c.path))
        .map((c) => c.path)
      if (residue.length === 0) return undefined
      const prose = residue.join(", ")
      return `${prose} still differ from ${base} at "${ctx.rest.state}" — the revert did not take. Run \`git checkout ${base} -- ${pathspec(residue)}\`, then \`gtd land\` again.`
    }),
}

/** The four step-capture guards, in EVALUATION order — message precedence when two would fire is observable, so this order is the contract (matches the old hand-copied call order, minus the now-removed steering-file guard). */
export const stepGuards: readonly StepGuard[] = [
  reviewDocGuard,
  feedbackProgressGuard,
  answerCompletenessGuard,
  requireRevertGuard,
]

/**
 * The `gtd land` capture gate: run every guard the resolved rest's state
 * applies to against ONE sample of the current committed/working bytes — see
 * the module docstring — and fail with the first refusal's reason, prefixed
 * `gtd land: ` (the one place that prefix, and `Commentary.ts`'s `renderFailure`
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
    const hasCodeChange = input.changes.some((c) => isCodePath(c.path))

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
