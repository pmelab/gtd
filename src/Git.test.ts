import { Cause, Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { GtdError } from "./Commentary.js"
import {
  isIndexLockError,
  resolvedRefOrCorrupted,
  withIndexLockRetry,
  withIndexLockRetries,
  type GitOperations,
} from "./Git.js"
import { gitTiers, runGitServiceContract, runGitScriptContract } from "./testing/GitTiers.js"

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

/**
 * `resolveRef`'s own validation, unit-tested directly rather than through a
 * real git repo — `git rev-parse --verify` exiting non-zero for a genuinely
 * missing ref is a plain `Error` from `exec` itself (covered by the contract
 * above's "errors on invalid ref"); this is the rarer, defensive branch where
 * the command SUCCEEDS but its output isn't a 40-hex-char hash — a corrupted
 * ref, gtd's one `GtdError` site in `Git.ts`.
 */
describe("resolvedRefOrCorrupted", () => {
  it("succeeds with a genuine 40-hex-char hash", async () => {
    const hash = "a".repeat(40)
    const result = await Effect.runPromise(resolvedRefOrCorrupted("HEAD", hash))
    expect(result).toBe(hash)
  })

  it("fails with a GtdError naming the ref, for anything else", async () => {
    const exit = await Effect.runPromiseExit(resolvedRefOrCorrupted("some-ref", "not-a-hash"))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(GtdError)
      expect(error).toHaveProperty("message", "Invalid ref: some-ref")
      if (error instanceof GtdError) expect(error.detail).toEqual(["ref: some-ref"])
    }
  })
})

/**
 * `GitScript.ts`'s bash builders, run through real `bash` against a real git
 * repo — the Live tier only, since the in-memory fake's root has no shell to
 * execute against. Asserts the same 9 writer postconditions as the contract
 * above, driven via the emitted script instead of the `GitOperations` port.
 */
describe("GitScript", () => {
  runGitScriptContract()
})

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
