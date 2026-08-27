import { describe, expect, it } from "vitest"
import { fakeGitOperations } from "./GitDoubles.js"
import { InMemRepo } from "./InMemRepo.js"
import { CONTRACT_COVERED_OPERATIONS } from "./GitTiers.js"

describe("GitTiers drift guards", () => {
  it("the contract covers every GitOperations method the fake implements", () => {
    expect([...CONTRACT_COVERED_OPERATIONS].sort()).toEqual(
      Object.keys(fakeGitOperations(new InMemRepo())).sort(),
    )
  })
})
