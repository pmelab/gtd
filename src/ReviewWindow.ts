/**
 * The review checkout window: while the workflow rests at the human review
 * gate (`gtd: await-review`), HEAD and the index are temporarily rewound to
 * the review base with the working tree untouched, so the entire
 * `reviewBase..HEAD` diff surfaces as ordinary uncommitted changes in any
 * editor's standard git integration (SCM panel, gutters, per-file diffs,
 * discard-hunk).
 *
 * Lifecycle — driven exclusively from the program edge (`src/program.ts`):
 *
 * - `openReviewWindow` runs AFTER a gtd invocation finishes and self-guards on
 *   HEAD being exactly `gtd: await-review`: it saves HEAD to
 *   `refs/gtd/review-head` (plus the base to `refs/gtd/review-base`), then
 *   `git reset --mixed <base>`. The same call re-arms the window after
 *   read-only commands (`gtd next` / `gtd status`) and refused invocations.
 * - `closeReviewWindow` runs BEFORE every dispatched invocation, keyed on ref
 *   existence: `git reset --mixed refs/gtd/review-head` restores HEAD/index
 *   exactly, leaving only the reviewer's own edits dirty.
 *
 * Invariants: the pure machine never observes an open window (the close hook
 * precedes every `gatherEvents`), the working tree is never touched, and the
 * reviewer's edits land as their own separate `gtd(human): review` turn commit
 * — never mixed into the reviewed package commits. Every step of open/close is
 * idempotent under re-entry, so a crash at any point is recovered by the next
 * invocation's close (the saved ref also keeps the real head GC-reachable for
 * the window's whole lifetime).
 */

import { Effect, Option } from "effect"
import { GitService } from "./Git.js"
import { parseSubject, ROUTING_SUBJECT } from "./Subjects.js"

export const REVIEW_HEAD_REF = "refs/gtd/review-head"
export const REVIEW_BASE_REF = "refs/gtd/review-base"

const AWAITING_REVIEW_SUBJECT = ROUTING_SUBJECT["await-review"]

const subjectOf = (message: string): string => message.split("\n")[0] ?? ""

/**
 * Pick the window's base commit from full first-parent history
 * (oldest→newest, HEAD last). Mirrors the review-scope rules of
 * `gatherEvents` (`src/Events.ts`) — newest `gtd: review <hash>` anchor →
 * last `gtd: await-review` → first grilling turn, all within the current
 * cycle (after the last `gtd: done`) — but EXCLUDES HEAD itself: at open
 * time HEAD is the `gtd: await-review` that triggered the window, and
 * rule 2's "last awaiting review" must mean the PREVIOUS round's, exactly
 * the base the agent's review record was written against. Returns undefined
 * when no rule applies (no window to open).
 */
export const reviewWindowBase = (
  history: ReadonlyArray<{ readonly hash: string; readonly message: string }>,
): string | undefined => {
  // Exclude HEAD (the awaiting-review routing commit that triggered the open).
  const beforeHead = history.slice(0, -1)

  let lastDoneIdx = -1
  for (let i = 0; i < beforeHead.length; i++) {
    if (subjectOf(beforeHead[i]!.message) === ROUTING_SUBJECT.done) lastDoneIdx = i
  }
  const currentCycle = beforeHead.slice(lastDoneIdx + 1)

  let anchor: string | undefined
  let lastAwaitingReview: string | undefined
  let firstGrilling: string | undefined
  for (const c of currentCycle) {
    const parsed = parseSubject(subjectOf(c.message))
    if (parsed.kind === "routing" && parsed.phase === "review" && parsed.param !== undefined) {
      anchor = parsed.param
    }
    if (parsed.kind === "routing" && parsed.phase === "await-review") {
      lastAwaitingReview = c.hash
    }
    // All three entry-capable gates count as the cycle start (mirrors
    // `isGrillingTurn` in src/Events.ts): `architecting` covers the
    // ARCHITECTURE.md escape-hatch entry and `grilled` the PLAN.md entry —
    // without them the window silently never opens for those cycles.
    if (
      parsed.kind === "turn" &&
      (parsed.gate === "grilling" || parsed.gate === "architecting" || parsed.gate === "grilled") &&
      firstGrilling === undefined
    ) {
      firstGrilling = c.hash
    }
  }

  return anchor ?? lastAwaitingReview ?? firstGrilling
}

/**
 * Restore the real head if a review checkout window is open; no-op otherwise.
 * Keyed on `refs/gtd/review-head` existence, NOT on any config or machine
 * state, so it always runs first and the machine never sees the window.
 *
 * Fails loudly — refs left in place — when HEAD is no longer on the reviewed
 * branch (the base is not an ancestor of HEAD, e.g. after a branch switch):
 * a mixed reset there would rewrite the wrong branch's tip. Manual commits on
 * top of the base pass the guard: the reset keeps their content in the
 * working tree, where the next turn capture picks it up as review feedback.
 */
export const closeReviewWindow: Effect.Effect<{ closed: boolean }, Error, GitService> = Effect.gen(
  function* () {
    const git = yield* GitService
    const savedHead = yield* git.readRefOption(REVIEW_HEAD_REF)
    if (Option.isNone(savedHead)) return { closed: false }

    const base = yield* git.readRefOption(REVIEW_BASE_REF)
    if (Option.isSome(base)) {
      const onReviewedBranch = yield* git.isAncestor(base.value, "HEAD")
      if (!onReviewedBranch) {
        return yield* Effect.fail(
          new Error(
            "a gtd review checkout window is open but HEAD has moved off the reviewed branch — " +
              "return to it, or restore manually with " +
              "`git reset --mixed refs/gtd/review-head && git update-ref -d refs/gtd/review-head && git update-ref -d refs/gtd/review-base`",
          ),
        )
      }
    }

    yield* git.mixedResetTo(REVIEW_HEAD_REF)
    yield* git.deleteRef(REVIEW_HEAD_REF)
    yield* git.deleteRef(REVIEW_BASE_REF)
    return { closed: true }
  },
)

/**
 * Open (or re-arm) the review checkout window. Self-guarded: a no-op unless
 * HEAD's subject is exactly `gtd: await-review` and a review base can be
 * derived from history, so the caller invokes it unconditionally after every
 * dispatched subcommand.
 *
 * Ordering is crash-safe: base ref → head ref → mixed reset → `.gtd/` index
 * restore → intent-to-add. A crash before the head-ref write leaves only a
 * stale base ref (overwritten on the next open); a crash after it leaves
 * HEAD == review-head, which the next invocation's close restores as a no-op.
 */
export const openReviewWindow: Effect.Effect<{ opened: boolean }, Error, GitService> = Effect.gen(
  function* () {
    const git = yield* GitService
    const hasCommits = yield* git.hasCommits()
    if (!hasCommits) return { opened: false }
    const subject = yield* git.lastCommitSubject()
    if (subject !== AWAITING_REVIEW_SUBJECT) return { opened: false }

    const history = yield* git.commitHistory()
    const base = reviewWindowBase(history)
    if (base === undefined) return { opened: false }
    const headHash = yield* git.resolveRef("HEAD")
    if (base === headHash) return { opened: false }

    yield* git.updateRef(REVIEW_BASE_REF, base)
    yield* git.updateRef(REVIEW_HEAD_REF, headHash)
    yield* git.mixedResetTo(base)
    // `.gtd/` (REVIEW.md, base-era plan files) is workflow plumbing, not part
    // of the reviewable diff — pin its index entries back to the saved head so
    // the editor's unstaged view shows only the code changes.
    yield* git.restoreStagedFrom(REVIEW_HEAD_REF, [".gtd"])
    // Files added since the base would otherwise show as untracked; register
    // them so editors render proper content diffs (and "discard" stays a
    // coherent reject-this-file gesture).
    yield* git.addIntentToAdd()
    return { opened: true }
  },
)
