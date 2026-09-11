import { Effect, Option } from "effect"
import type { GitOperations, GitReaderOperations, GitWriterOperations } from "../Git.js"
import { InMemRepo } from "./InMemRepo.js"

const tryCatch = <A>(fn: () => A): Effect.Effect<A, Error> =>
  Effect.try({
    try: fn,
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

const makeGitReaderOps = (repo: InMemRepo, root: string): GitReaderOperations => ({
  hasCommits: () => Effect.succeed(repo.hasCommits()),

  lastCommitSubject: (ref?: string) => {
    const subject = repo.lastCommitSubject(ref)
    return subject !== null ? Effect.succeed(subject) : Effect.fail(new Error("No commits"))
  },

  lastCommitMessage: () => {
    const message = repo.lastCommitMessage()
    return message !== null ? Effect.succeed(message) : Effect.fail(new Error("No commits"))
  },

  resolveRef: (ref: string) => {
    const hash = repo.resolveRef(ref)
    return hash !== null
      ? Effect.succeed(hash)
      : Effect.fail(new Error(`Cannot resolve ref: ${ref}`))
  },

  readFileAtRef: (ref: string, path: string) => {
    const content = repo.fileAtRef(ref, path)
    return content !== null
      ? Effect.succeed(content)
      : Effect.fail(new Error(`path not found at ${ref}: ${path}`))
  },

  readRefOption: (ref: string) => {
    const hash = repo.resolveRef(ref)
    return Effect.succeed(hash !== null ? Option.some(hash) : Option.none<string>())
  },

  isAncestor: (a: string, b: string) => Effect.succeed(repo.isAncestor(a, b)),

  topLevel: () => Effect.succeed(root),

  /**
   * The fake models a single worktree only (`GitTierCapabilities.linkedWorktrees`
   * is false for this tier), so this is simply `${root}/.git` — real git's
   * per-worktree distinction (a linked worktree's own `.git/worktrees/<name>`)
   * has no in-memory counterpart to model.
   */
  gitDir: () => Effect.succeed(`${root}/.git`),

  commitHistory: (base?: string, head?: string) => Effect.succeed(repo.commitHistory(base, head)),

  changedPaths: (base?: string) => Effect.succeed(repo.changedPathsWorktree(base)),
})

const makeGitWriterOps = (repo: InMemRepo): GitWriterOperations => ({
  commitAllWithPrefix: (prefix: string) => tryCatch(() => repo.commitAllWithPrefix(prefix)),
  softResetTo: (ref: string) => tryCatch(() => repo.softResetTo(ref)),
  commitAsIs: (message: string) => tryCatch(() => repo.commitAsIs(message)),
  discardPending: () => tryCatch(() => repo.discardPending()),
  updateRef: (ref: string, hash: string) => tryCatch(() => repo.updateRef(ref, hash)),
  deleteRef: (ref: string) => tryCatch(() => repo.deleteRef(ref)),
  mixedResetTo: (ref: string) => tryCatch(() => repo.mixedResetTo(ref)),
  hardResetTo: (ref: string) => tryCatch(() => repo.hardResetTo(ref)),
})

/**
 * The in-memory tier's `GitOperations` — reader + writer,
 * backed by one `InMemRepo`. `root` (default `/repo`, matching
 * `GitTiers.ts`'s `IN_MEM_ROOT`) is only consumed by `topLevel`/`gitDir` — no
 * other operation cares where the fake's worktree "lives".
 */
export const fakeGitOperations = (repo: InMemRepo, root = "/repo"): GitOperations => ({
  ...makeGitReaderOps(repo, root),
  ...makeGitWriterOps(repo),
})
