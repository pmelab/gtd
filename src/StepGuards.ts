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

export type GuardRequirements = RepoFiles | GitService

/** A guard's verdict: `undefined` allows the step; a string is the refusal reason (the `gtd land: ` prefix is added once, by `enforceStepGuards`). */
export type Refusal = string | undefined

/** Everything a guard's `check` needs — assembled once per `enforceStepGuards` call, shared by every applicable guard. */
export interface GuardContext {
  readonly rest: ResolvedRest
  /** The rest state's rendered `file:` — non-optional, since `enforceStepGuards` already returned early when the state declares none. */
  readonly file: string
  readonly changes: readonly PendingChange[]
  readonly fileDeleted: boolean
  /** True when this step touches a path outside gtd's plumbing directory (`STATE_DIR`) — the human edited something real. */
  readonly hasCodeChange: boolean
  readonly template: TemplateContext
  /**
   * `file`'s contents at the PRE-TURN head, `undefined` if absent there.
   * Real `HEAD` normally, but the review window's saved head
   * (`Rest.windowHead`) while a window is open — real HEAD is rewound to the
   * review base there, where a file the process itself added doesn't exist
   * yet, so a guard reaching for real `HEAD` instead would see it as absent.
   */
  readonly head: Effect.Effect<string | undefined, Error>
  /** `file`'s CURRENT working-tree contents — whatever is on disk right now, pre- or post- an external driver's own `format:` run. Cached. */
  readonly worktree: Effect.Effect<string | undefined, Error>
}

export interface StepGuard {
  readonly name: string
  /** Pure — decided from the definition/state alone, before any IO is paid for. */
  readonly appliesTo: (rest: ResolvedRest) => boolean
  readonly check: (ctx: GuardContext) => Effect.Effect<Refusal, Error, GuardRequirements>
}

/** True when `changes` deletes `file` — shared by `GuardContext.fileDeleted` and `program.ts`'s `steeringModeSteps`, so both ask it the same way. */
export const deletesFile = (changes: readonly PendingChange[], file: string): boolean =>
  changes.some((c) => c.path === file && c.status === "D")

/**
 * True when `path` sits inside gtd's plumbing directory. Exact match or
 * `STATE_DIR + "/"` prefix — a naive `path.startsWith(STATE_DIR)` would also
 * swallow a sibling `.gtd-backup/`.
 */
const isPlumbingPath = (path: string): boolean =>
  path === STATE_DIR || path.startsWith(`${STATE_DIR}/`)

/** True for a real code path (outside gtd's plumbing directory) — every state's `file:` compiles under `STATE_DIR` too, so this already excludes a state's own steering file. */
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
 * Three properties that matter here, each the difference between a real guard
 * and an inert or permanently-refusing one: scoped to the human's own
 * review-round commit's paths, not "everything non-steering" (an unscoped
 * test would refuse every round, since e.g. `requirementsFile` is
 * var-configurable to the repo root); comparison direction must MATCH `base`
 * (the review base's parent), never merely differ from `reviewBase` — the
 * inverse reading is inert on a `text=auto` repo, where a committed-vs-
 * worktree byte comparison never matches; and the review file itself needs no
 * exact-path exemption since it compiles under `STATE_DIR`, already excluded
 * by `isCodePath`.
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
 * The `gtd land` capture gate: run every applicable guard against one sample
 * of the current committed/working bytes, and fail with the first refusal's
 * reason, prefixed `gtd land: ` (the one place that prefix, and
 * `Commentary.ts`'s `renderFailure` `/^gtd[: ]/` contract, is satisfied). A
 * no-op for a squash/no-op decision, an ATTEMPT commit (empty diff by
 * construction — nothing for any guard to check), a state with no `file:`, or
 * a state no guard applies to.
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
   * True for an ATTEMPT commit — a fruitless `prompt`-state dispatch whose
   * diff is EMPTY by construction. Bypasses every guard like a squash/no-op
   * decision: running a mode's `format:` here could dirty the tree and turn
   * an "empty" attempt non-empty, breaking the derivation `stalledAt` relies
   * on.
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
