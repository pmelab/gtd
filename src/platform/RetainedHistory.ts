import { Effect, Option } from "effect"
import type { GitOperations } from "./Git.js"

/** Per-worktree (`refs/worktree/gtd/*`) so linked worktrees sharing one `.git` don't clobber each other's retained history. */
export const HISTORY_REF = "refs/worktree/gtd/history"

/** Set by an abandon that left `gtd/<b>` for `<b>`: only then does restore recreate `gtd/<b>`. */
export const RESUME_BRANCH_REF = "refs/worktree/gtd/history-branch"

/** One ref per finished process, kept past the branch's deletion; distinct from the per-worktree `HISTORY_REF`. */
export const PROCESS_HISTORY_PREFIX = "refs/gtd/history/"

export const processHistoryRef = (hash: string): string => `${PROCESS_HISTORY_PREFIX}${hash}`

/** Directory of a step's turns set aside by `keep: true`, each at `<this>/<kept hash>`; own namespace, so history list/show/fetch never see it. */
export const keptRef = (entry: string, step: string): string => `refs/gtd/kept/${entry}/${step}`

/** A ship's process tip, kept locally so the commit on `<b>` carries no trace of gtd (ADR 0011). */
export const shippedRef = (ship: string): string => `refs/gtd/shipped/${ship}`

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
