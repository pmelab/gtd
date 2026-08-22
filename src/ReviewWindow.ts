import { Effect, Option } from "effect"
import { GitService, type GitOperations } from "./Git.js"
import { isReviewWindowState, type StateName, type WorkflowDefinition } from "./PatternMachine.js"
import { reviewBaseFor, type ProcessRun } from "./Edge.js"
import { deleteRef, mixedResetTo, restoreStagedFrom, updateRef } from "./GitScript.js"

/**
 * Per-worktree (`refs/worktree/*`) so linked worktrees sharing one `.git`
 * don't clobber each other's window.
 */
export const REVIEW_HEAD_REF = "refs/worktree/gtd/review-head"
export const REVIEW_BASE_REF = "refs/worktree/gtd/review-base"

/** The pre-7.2 shared refs — gtd never writes them, only reads them to finish a window an older gtd left open across the upgrade. */
export const LEGACY_REVIEW_HEAD_REF = "refs/gtd/review-head"
export const LEGACY_REVIEW_BASE_REF = "refs/gtd/review-base"

// git's empty-tree object — `startParentHash` when a process covers the whole
// history with no earlier commit to rewind to, so the window stays closed.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/** The ref pair an open window is recorded under, plus whether it is the legacy shared pair. */
export interface WindowRefs {
  readonly headRef: string
  readonly baseRef: string
  readonly headHash: string
  readonly legacy: boolean
}

/** The manual-recovery incantation every close refusal ends with. */
const manualRecovery = (refs: WindowRefs): string =>
  `\`git reset --mixed ${refs.headRef} && git update-ref -d ${refs.headRef} && ` +
  `git update-ref -d ${refs.baseRef}\``

/**
 * Which ref pair (if any) records an open window: this worktree's own
 * `refs/worktree/gtd/*` pair first, falling back to the pre-7.2 shared
 * `refs/gtd/*` pair so an upgrade mid-window still closes cleanly.
 */
const openWindowRefs = (git: GitOperations): Effect.Effect<Option.Option<WindowRefs>, Error> =>
  Effect.gen(function* () {
    const scoped = yield* git.readRefOption(REVIEW_HEAD_REF)
    if (Option.isSome(scoped)) {
      return Option.some({
        headRef: REVIEW_HEAD_REF,
        baseRef: REVIEW_BASE_REF,
        headHash: scoped.value,
        legacy: false,
      })
    }
    const legacy = yield* git.readRefOption(LEGACY_REVIEW_HEAD_REF)
    if (Option.isNone(legacy)) return Option.none()
    return Option.some({
      headRef: LEGACY_REVIEW_HEAD_REF,
      baseRef: LEGACY_REVIEW_BASE_REF,
      headHash: legacy.value,
      legacy: true,
    })
  })

/**
 * Whether a caller should run the close sequence, keyed on the saved-head
 * ref's existence alone, so `program.ts` can always call this first without
 * the pure machine ever seeing the window. Fails (refs left in place) when
 * HEAD has moved off the reviewed branch — a mixed reset there would rewrite
 * the wrong branch's tip. Manual commits on top of the base still pass: the
 * reset keeps their content in the working tree as review feedback.
 */
export type CloseWindowDecision =
  | { readonly shouldClose: false }
  | { readonly shouldClose: true; readonly refs: WindowRefs }

export const decideCloseWindow: Effect.Effect<CloseWindowDecision, Error, GitService> = Effect.gen(
  function* () {
    const git = yield* GitService
    const open = yield* openWindowRefs(git)
    if (Option.isNone(open)) return { shouldClose: false }
    const refs = open.value

    const base = yield* git.readRefOption(refs.baseRef)
    if (Option.isSome(base) && base.value !== EMPTY_TREE) {
      const onReviewedBranch = yield* git.isAncestor(base.value, "HEAD")
      if (!onReviewedBranch) {
        return yield* Effect.fail(
          new Error(
            "a gtd review checkout window is open but HEAD has moved off the reviewed branch — " +
              `return to it, or restore manually with ${manualRecovery(refs)}`,
          ),
        )
      }
    }

    if (refs.legacy) {
      const ownsWindow = yield* git.isAncestor("HEAD", refs.headHash)
      if (!ownsWindow) {
        return yield* Effect.fail(
          new Error(
            `a review checkout window is recorded under the shared ${LEGACY_REVIEW_HEAD_REF} ` +
              "(written by gtd 7.1 or older) but it does not belong to this worktree — HEAD is " +
              "not contained in it. gtd now scopes the window per worktree " +
              `(${REVIEW_HEAD_REF}); in the worktree that owns it, run ${manualRecovery(refs)}`,
          ),
        )
      }
    }

    return { shouldClose: true, refs }
  },
)

/**
 * PURE: the close sequence's bash text — reset to the saved head, then delete
 * both refs — built from `src/GitScript.ts`'s `mixedResetTo`/`deleteRef`.
 * Assumes its caller's guards (the reviewed-branch check, the legacy
 * containment check — see `decideCloseWindow`) have already passed; this
 * builder performs none of them, only the write sequence for the case where
 * they did.
 *
 * Resets to `refs.headHash` (the resolved hash), not `refs.headRef` by name —
 * the very next statement deletes that ref, so naming it for the reset would
 * fail on re-entry. A hash stays resolvable regardless, keeping the sequence
 * idempotent.
 */
export const buildCloseWindowScript = (refs: WindowRefs): string =>
  [mixedResetTo(refs.headHash), deleteRef(refs.headRef), deleteRef(refs.baseRef)].join(" &&\n")

/**
 * Whether a window should open, and at what base/head. Takes `target`
 * explicitly rather than resolving it itself, since the caller (a step about
 * to land a commit) knows the matched-pattern target before that commit
 * exists.
 */
export type OpenWindowDecision =
  | { readonly shouldOpen: false }
  | { readonly shouldOpen: true; readonly base: string; readonly head: string }

export const decideOpenWindow = (
  def: WorkflowDefinition,
  target: StateName,
  run: ProcessRun,
  head: string,
): OpenWindowDecision => {
  if (!isReviewWindowState(def, target)) return { shouldOpen: false }
  const base = reviewBaseFor(def, run)
  // No real base commit to rewind to (whole-history process), or an empty
  // process with nothing committed yet — nothing to surface, so stay closed.
  if (base === EMPTY_TREE || base === head) return { shouldOpen: false }
  return { shouldOpen: true, base, head }
}

/**
 * The open sequence's bash text: base-ref write, head-ref write,
 * mixed-reset-to-base, then a `.gtd/`-scoped `restoreStagedFrom` pin. No `git
 * add --intent-to-add` — that both loses the index-lock race and truncates
 * discarded files to zero bytes — so new files stay untracked; new files
 * outside `.gtd/` stay unpinned too, since `restoreStagedFrom` is scoped
 * there alone. Idempotent under re-entry.
 *
 * `".gtd"` is a deliberate literal, not derived from states' `file:`
 * declarations — it must also cover paths no state declares (a check
 * script's temp output), and `src/testing/EmittedScriptRecognizer.ts`'s
 * `recognizeReviewWindowOpen` re-derives this exact string to recognize the
 * script, which only works while it's fixed.
 */
export const buildOpenWindowScript = (decision: {
  readonly base: string
  readonly head: string
}): string =>
  [
    updateRef(REVIEW_BASE_REF, decision.base),
    updateRef(REVIEW_HEAD_REF, decision.head),
    mixedResetTo(decision.base),
    restoreStagedFrom(REVIEW_HEAD_REF, [".gtd"]),
  ].join(" &&\n")
