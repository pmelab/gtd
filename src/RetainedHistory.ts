import { Effect, Option } from "effect"
import type { GitOperations } from "./Git.js"

/** Per-worktree (`refs/worktree/gtd/*`, like `ReviewWindow.ts`'s refs) so linked worktrees sharing one `.git` don't clobber each other's retained history. */
export const HISTORY_REF = "refs/worktree/gtd/history"

const HISTORY_TRAILER_PREFIX = "Gtd-History: "
const HISTORY_TRAILER_RE = /^Gtd-History:[ \t]*(\S+)[ \t]*$/m

/** Appends a `Gtd-History: <hash>` trailer recording the pre-squash tip, for `gtd restore` to read back later. */
export const withHistoryTrailer = (subject: string, hash: string): string =>
  `${subject}\n\n${HISTORY_TRAILER_PREFIX}${hash}`

const parseHistoryTrailer = (message: string): string | undefined =>
  HISTORY_TRAILER_RE.exec(message)?.[1]

/** No-op when `tipHash === startParentHash`: an empty process has no turn chain worth keeping. */
export const retainHistory = (
  git: GitOperations,
  tipHash: string,
  startParentHash: string,
): Effect.Effect<void, Error> =>
  tipHash === startParentHash ? Effect.void : git.updateRef(HISTORY_REF, tipHash)

export const readRetainedHistory = (
  git: GitOperations,
): Effect.Effect<Option.Option<string>, Error> => git.readRefOption(HISTORY_REF)

/**
 * Whether resetting to `tipHash` is safe: either HEAD is the squash commit
 * that still carries the matching `Gtd-History:` trailer (resetting discards
 * only that one commit), or HEAD is an ancestor of `tipHash` (nothing on top
 * would be lost). Anything else is refused.
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
