/**
 * `GitOperations` test doubles: `fakeGitOperations` (backed by `InMemRepo`,
 * the in-memory tier's git implementation) and `strictGitOperations` (a
 * Proxy failing on any method a test didn't override — replaces the
 * hand-maintained 20-method stub literals `Edge.test.ts`/
 * `RetainedHistory.test.ts`/`program.test.ts` used to carry).
 */

import { Effect, Option } from "effect"
import type { GitOperations, GitReaderOperations, GitWriterOperations } from "../Git.js"
import { InMemRepo, TEST_DOUBLE_SENTINEL } from "./InMemRepo.js"

const tryCatch = <A>(fn: () => A): Effect.Effect<A, Error> =>
  Effect.try({
    try: fn,
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/** An error shaped like git's `index.lock` contention failure — matches `isIndexLockError` (`src/Git.ts`). */
export const indexLockError = (): Error =>
  new Error(
    "git add -A failed (exit 128): fatal: Unable to create '/repo/.git/index.lock': File exists.",
  )

const makeGitReaderOps = (repo: InMemRepo): GitReaderOperations => ({
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

  topLevel: () => Effect.succeed("/repo"),

  commitHistory: (base?: string, head?: string) => Effect.succeed(repo.commitHistory(base, head)),

  changedPaths: (base?: string) => Effect.succeed(repo.changedPathsWorktree(base)),

  changedPathsSince: (ref: string) =>
    tryCatch(() => {
      if (repo.resolveRef(ref) === null) {
        throw new Error(`Cannot resolve ref: ${ref}`)
      }
      return repo.changedPathsBetween(ref, "HEAD")
    }),
})

/**
 * Writer operations, each consuming the repo's fault queue
 * (`InMemRepo.takeInjectedFault`) before running: a queued fault fails the
 * effect WITHOUT performing the write, mirroring a real `index.lock` failure
 * (git did nothing). Readers never take the lock, so they bypass the queue
 * entirely — only writers are wrapped here.
 */
const makeGitWriterOps = (repo: InMemRepo): GitWriterOperations => {
  const guarded =
    <Args extends unknown[]>(fn: (...args: Args) => void) =>
    (...args: Args): Effect.Effect<void, Error> =>
      // `Effect.suspend` — a retry must RE-CHECK the fault queue on every
      // attempt, not replay one fixed Effect value computed at call time.
      // `takeInjectedFault` consumes the queue eagerly, so this whole body
      // (not just `tryCatch`'s inner thunk) must stay lazy for
      // `withIndexLockRetries` to see the queue drain across retries.
      Effect.suspend(() => {
        const fault = repo.takeInjectedFault()
        if (fault !== undefined) return Effect.fail(fault)
        return tryCatch(() => fn(...args))
      })

  return {
    commitAllWithPrefix: guarded((prefix: string) => repo.commitAllWithPrefix(prefix)),
    softResetTo: guarded((ref: string) => repo.softResetTo(ref)),
    commitAsIs: guarded((message: string) => repo.commitAsIs(message)),
    discardPending: guarded(() => repo.discardPending()),
    updateRef: guarded((ref: string, hash: string) => repo.updateRef(ref, hash)),
    deleteRef: guarded((ref: string) => repo.deleteRef(ref)),
    mixedResetTo: guarded((ref: string) => repo.mixedResetTo(ref)),
    hardResetTo: guarded((ref: string) => repo.hardResetTo(ref)),
    restoreStagedFrom: guarded((source: string, paths: ReadonlyArray<string>) =>
      repo.restoreStagedFrom(source, paths),
    ),
  }
}

/** The in-memory tier's `GitOperations` — reader + (fault-queue-aware) writer, backed by one `InMemRepo`. */
export const fakeGitOperations = (repo: InMemRepo): GitOperations => ({
  ...makeGitReaderOps(repo),
  ...makeGitWriterOps(repo),
})

/**
 * A `GitOperations` Proxy: `overrides` supply the methods a test actually
 * exercises; every other method fails loudly the moment it's called — no
 * method list to keep in sync with `GitReaderOperations`/`GitWriterOperations`
 * (unlike a plain object literal, which needs a case per port method).
 * `message`, when given, replaces the default per-method wording (e.g.
 * `program.test.ts`'s "GitService must not be called for --version/--help").
 */
export const strictGitOperations = (
  overrides: Partial<GitOperations>,
  message?: (name: string) => string,
): GitOperations =>
  new Proxy(overrides, {
    get(target, prop: string | symbol) {
      if (typeof prop === "symbol" || prop in target) {
        return (target as Record<string | symbol, unknown>)[prop as string]
      }
      const name = String(prop)
      return () =>
        Effect.fail(
          new Error(
            message?.(name) ??
              `${name} should not have been called by this test (${TEST_DOUBLE_SENTINEL})`,
          ),
        )
    },
  }) as GitOperations
