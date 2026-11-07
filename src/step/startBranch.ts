import { Effect, Option } from "effect"
import { GitService } from "../platform/index.js"
import { PROCESS_HISTORY_PREFIX } from "../platform/index.js"

export const GTD_BRANCH_PREFIX = "gtd/"

/** `<b>` for a `gtd/<b>` branch name; `undefined` for any other. */
export const userBranchOf = (branch: string): string | undefined =>
  branch.startsWith(GTD_BRANCH_PREFIX) ? branch.slice(GTD_BRANCH_PREFIX.length) : undefined

/** A branch already named `gtd/…` and a detached HEAD start in place. */
export type StartBranch =
  | { readonly kind: "inPlace" }
  | { readonly kind: "switch"; readonly branch: string }
  | { readonly kind: "refusal"; readonly message: string }

/**
 * Where a new process starts: on `gtd/<b>`, so `<b>` never carries its commits.
 * An existing `gtd/<b>` is reused only when its tip is contained in `<b>` or in
 * a kept history ref (a squash onto `<b>` never makes it an ancestor).
 */
export const startBranchFor = (
  commandLabel: string,
): Effect.Effect<StartBranch, Error, GitService> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const current = yield* git.currentBranch()
    if (Option.isNone(current) || current.value.startsWith(GTD_BRANCH_PREFIX)) {
      return { kind: "inPlace" } as const
    }
    if (!(yield* git.hasCommits())) return { kind: "inPlace" } as const
    const branch = `${GTD_BRANCH_PREFIX}${current.value}`
    const existing = yield* git.readRefOption(`refs/heads/${branch}`)
    if (Option.isSome(existing)) {
      const head = yield* git.resolveRef("HEAD")
      let contained = yield* git.isAncestor(existing.value, head)
      if (!contained) {
        const kept = yield* git.listRefs(PROCESS_HISTORY_PREFIX)
        for (const k of kept) {
          if (yield* git.isAncestor(existing.value, k.hash)) {
            contained = true
            break
          }
        }
      }
      if (!contained) {
        return {
          kind: "refusal",
          message: `${commandLabel}: branch ${branch} holds commits that are neither on ${current.value} nor in a kept history ref — merge or delete it first`,
        } as const
      }
    }
    return { kind: "switch", branch } as const
  })
