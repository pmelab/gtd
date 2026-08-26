import { Effect, Option } from "effect"
import type { GitOperations } from "./Git.js"

/** Per-worktree (`refs/worktree/gtd/*`) so linked worktrees sharing one `.git` don't clobber each other's retained history. */
export const HISTORY_REF = "refs/worktree/gtd/history"

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
 * Whether resetting to `tipHash` is safe: HEAD must be an ancestor of
 * `tipHash` (nothing on top of the retained tip would be lost). Anything else
 * is refused.
 */
export const restorability = (
  git: GitOperations,
  headHash: string,
  tipHash: string,
): Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly reason: string }, Error> =>
  Effect.gen(function* () {
    const isAncestor = yield* git.isAncestor(headHash, tipHash)
    if (isAncestor) return { ok: true }

    return {
      ok: false,
      reason:
        "HEAD has advanced past the retained tip — restoring would discard commits built on top of it",
    }
  })

/** Idempotent: `deleteRef` already tolerates a missing ref. */
export const clearRetainedHistory = (git: GitOperations): Effect.Effect<void, Error> =>
  git.deleteRef(HISTORY_REF)
