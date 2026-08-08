import { describe, expect, it } from "vitest"
import { isIndexLockError } from "../Git.js"
import { fakeGitOperations, indexLockError } from "./GitDoubles.js"
import { InMemRepo } from "./InMemRepo.js"
import { CONTRACT_COVERED_OPERATIONS } from "./GitTiers.js"

describe("GitTiers drift guards", () => {
  it("the contract covers every GitOperations method the fake implements", () => {
    expect([...CONTRACT_COVERED_OPERATIONS].sort()).toEqual(
      Object.keys(fakeGitOperations(new InMemRepo())).sort(),
    )
  })

  it("the fake's fault shape is recognized by the production isIndexLockError matcher", () => {
    expect(isIndexLockError(indexLockError())).toBe(true)
  })
})
