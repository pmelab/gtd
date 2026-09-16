import { Cause, Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { InvalidRefError, resolvedRefOrCorrupted } from "./Git.js"
import { gitTiers, runGitServiceContract, runGitScriptContract } from "../testing/index.js"

/**
 * The `GitOperations` contract, run identically against both the Live and
 * InMemory tiers (`src/testing/GitTiers.ts`) — 20 operations × 2 tiers.
 */
for (const makeTier of gitTiers) {
  const name = makeTier().name
  describe(`GitService [${name}]`, () => {
    runGitServiceContract(makeTier)
  })
}

/**
 * `resolveRef`'s own validation, unit-tested directly rather than through a
 * real git repo — this is the rarer, defensive branch where the command
 * SUCCEEDS but its output isn't a 40-hex-char hash: a corrupted ref, this
 * module's own `InvalidRefError`.
 */
describe("resolvedRefOrCorrupted", () => {
  it("succeeds with a genuine 40-hex-char hash", async () => {
    const hash = "a".repeat(40)
    const result = await Effect.runPromise(resolvedRefOrCorrupted("HEAD", hash))
    expect(result).toBe(hash)
  })

  it("fails with an InvalidRefError naming the ref, for anything else", async () => {
    const exit = await Effect.runPromiseExit(resolvedRefOrCorrupted("some-ref", "not-a-hash"))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(InvalidRefError)
      expect(error).toHaveProperty("message", "Invalid ref: some-ref")
      if (error instanceof InvalidRefError) expect(error.detail).toEqual(["ref: some-ref"])
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
