import { Effect, Option } from "effect"
import type { GitOperations } from "./Git.js"

/**
 * Retention of a squashed (or abandoned) process's turn-by-turn history —
 * Task C of `docs/design/pattern-machine-plan.md`'s follow-up note (see
 * `.gtd/packages/01-retention-primitives.md`). Squashing collapses a whole
 * cycle's turn commits into one; this module records the pre-squash tip so a
 * later `gtd restore` (a separate, not-yet-built command-layer piece of work)
 * can bring those turns back.
 */

/**
 * The retained-history ref lives in git's PER-WORKTREE `refs/worktree/gtd/*`
 * namespace — the same one `src/ReviewWindow.ts` uses for `REVIEW_HEAD_REF`/
 * `REVIEW_BASE_REF`, for the same reason: linked worktrees sharing one `.git`
 * must not clobber each other's retained history (issue #118).
 */
export const HISTORY_REF = "refs/worktree/gtd/history"

const HISTORY_TRAILER_PREFIX = "Gtd-History: "
// One `Gtd-History: <hash>` trailer line — same shape as `Edge.ts`'s `REVIEW_BASE_TRAILER_RE`.
const HISTORY_TRAILER_RE = /^Gtd-History:[ \t]*(\S+)[ \t]*$/m

/**
 * Append a `Gtd-History: <hash>` trailer (after a blank line) to a commit
 * `subject` — records the pre-squash tip commit hash so a later `gtd restore`
 * command can read it back. Mirrors `Edge.ts`'s `withReviewBaseTrailer`
 * placement: the subject (first line) is untouched.
 */
export const withHistoryTrailer = (subject: string, hash: string): string =>
  `${subject}\n\n${HISTORY_TRAILER_PREFIX}${hash}`

/**
 * The `Gtd-History: <hash>` trailer recorded on a squash commit (see
 * `withHistoryTrailer`), or `undefined` when `message` carries none. Read back
 * by a later `gtd restore` command to recover the pre-squash tip.
 */
export const parseHistoryTrailer = (message: string): string | undefined =>
  HISTORY_TRAILER_RE.exec(message)?.[1]

/**
 * Record the pre-squash tip so a later `gtd restore` can find it. A no-op
 * (the git call is skipped entirely) when `tipHash === startParentHash`: an
 * empty process — no turns were ever committed — has no turn chain worth
 * keeping.
 */
export const retainHistory = (
  git: GitOperations,
  tipHash: string,
  startParentHash: string,
): Effect.Effect<void, Error> =>
  tipHash === startParentHash ? Effect.void : git.updateRef(HISTORY_REF, tipHash)

/** A thin wrapper over `git.readRefOption(HISTORY_REF)`. */
export const readRetainedHistory = (
  git: GitOperations,
): Effect.Effect<Option.Option<string>, Error> => git.readRefOption(HISTORY_REF)

/**
 * The safety predicate deciding whether a future `gtd restore` to `tipHash`
 * would be safe. Accepts exactly two shapes:
 *
 * (a) Fresh squash — HEAD IS the squash commit (a brand-new commit distinct
 *     from `tipHash`, the pre-squash tip it collapsed) and its own message
 *     still carries the `Gtd-History:` trailer pointing at that tip
 *     (`parseHistoryTrailer(headMessage) === tipHash`). Hard-resetting from
 *     here discards only that one squash commit, whose tree equals the tip's
 *     — no content loss. If HEAD's trailer names a DIFFERENT hash (or none),
 *     either a newer squash/abandon has since superseded this ref or HEAD
 *     isn't a squash commit at all, so this falls through to (b) rather than
 *     trusting a stale or absent match.
 * (b) Cleaned abandon / fast-forward — HEAD is an ancestor of the retained
 *     tip (`git.isAncestor(headHash, tipHash)`), i.e. nothing built on top of
 *     the tip would be discarded by resetting back to it.
 *
 * Anything else is refused with a reason naming what would be lost.
 */
export const restorability = (
  git: GitOperations,
  headHash: string,
  headMessage: string,
  tipHash: string,
): Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly reason: string }, Error> =>
  Effect.gen(function* () {
    if (parseHistoryTrailer(headMessage) === tipHash) return { ok: true }

    const isAncestor = yield* git.isAncestor(headHash, tipHash)
    if (isAncestor) return { ok: true }

    return {
      ok: false,
      reason:
        "HEAD has advanced past the squash — restoring would discard commits built on top of it",
    }
  })

/** Idempotent: `deleteRef` already tolerates a missing ref. */
export const clearRetainedHistory = (git: GitOperations): Effect.Effect<void, Error> =>
  git.deleteRef(HISTORY_REF)
