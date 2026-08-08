import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  isIndexLockError,
  withIndexLockRetry,
  withIndexLockRetries,
  type GitOperations,
} from "./Git.js"
import { gitTiers, runGitServiceContract } from "./testing/GitTiers.js"

/**
 * The `GitOperations` contract, run identically against both the Live and
 * InMemory tiers (`src/testing/GitTiers.ts`) — 20 operations × 2 tiers, plus
 * the retry-wiring assertions that prove `withIndexLockRetries` is actually
 * applied at both `GitService.Live` and the in-memory layer.
 */
for (const makeTier of gitTiers) {
  const name = makeTier().name
  describe(`GitService [${name}]`, () => {
    runGitServiceContract(makeTier)
  })
}

// ---------------------------------------------------------------------------
// index.lock contention retry — pure, tier-free unit assertions. The
// review window shares one worktree index with the reviewer's editor/lsp/
// prompt, all of which write the index to refresh their stat cache when a
// `git reset --mixed` wakes them. gtd's own index writes must ride out the
// resulting `index.lock` race, not fail on it. Tier-specific "does a real
// operation actually survive a lock" coverage lives in the contract above
// (`runGitServiceContract`'s "retry wiring" group, via `induceIndexLockOnce`).
// ---------------------------------------------------------------------------

describe("index.lock retry", () => {
  it("recognizes git's index.lock contention message and nothing else", () => {
    expect(
      isIndexLockError(
        new Error(
          "git add -A failed (exit 128): fatal: Unable to create " +
            "'/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running",
        ),
      ),
    ).toBe(true)
    // A different non-zero exit (a rejected commit, a missing ref) must NOT retry.
    expect(isIndexLockError(new Error("git commit failed (exit 1): nothing to commit"))).toBe(false)
  })

  it("retries a transient lock error to success, but propagates any other failure at once", async () => {
    let lockAttempts = 0
    await expect(
      Effect.runPromise(
        withIndexLockRetry(
          Effect.suspend(() => {
            lockAttempts += 1
            return lockAttempts < 3
              ? Effect.fail(new Error("Unable to create 'index.lock': File exists"))
              : Effect.succeed("ok")
          }),
        ),
      ),
    ).resolves.toBe("ok")
    expect(lockAttempts).toBe(3)

    let otherAttempts = 0
    const res = await Effect.runPromise(
      Effect.either(
        withIndexLockRetry(
          Effect.suspend(() => {
            otherAttempts += 1
            return Effect.fail(new Error("nothing to commit"))
          }),
        ),
      ),
    )
    expect(res._tag).toBe("Left")
    expect(otherAttempts).toBe(1)
  })
})

describe("withIndexLockRetries", () => {
  it("wraps every method of a GitOperations object, retrying each through a transient lock", async () => {
    let attempts = 0
    const ops = {
      resolveRef: () =>
        Effect.suspend(() => {
          attempts += 1
          return attempts < 2
            ? Effect.fail(new Error("Unable to create 'index.lock': File exists"))
            : Effect.succeed("deadbeef")
        }),
    } as unknown as GitOperations
    const wrapped = withIndexLockRetries(ops)
    await expect(Effect.runPromise(wrapped.resolveRef("HEAD"))).resolves.toBe("deadbeef")
    expect(attempts).toBe(2)
  })

  it("still propagates a non-lock error on the first attempt", async () => {
    let attempts = 0
    const ops = {
      hasCommits: () => {
        attempts += 1
        return Effect.fail(new Error("boom"))
      },
    } as unknown as GitOperations
    const wrapped = withIndexLockRetries(ops)
    const result = await Effect.runPromise(Effect.either(wrapped.hasCommits()))
    expect(result._tag).toBe("Left")
    expect(attempts).toBe(1)
  })
})
