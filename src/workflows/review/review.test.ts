import { describe, expect, it } from "vitest"
import { testRepo } from "../../testkit/index.js"
import { CONFIG_SCAFFOLD } from "../../install/index.js"
import { reviewDoc } from "../shared/config.fixture.js"
import { base } from "./review.js"

const REVIEW = ".gtd/REVIEW.md"
const ORIG = ".gtd/REVIEW.orig.md"

describe("the review workflow", () => {
  it("refuses a pending hand-off before requesting any step, the gate's check included", async () => {
    const repo = testRepo({
      workflow: CONFIG_SCAFFOLD,
      files: { [REVIEW]: reviewDoc("note"), [ORIG]: reviewDoc("orig") },
    })
    await expect(repo.door("review")).rejects.toThrow(".gtd/REVIEW.orig.md is a pending hand-off")
    expect(repo.subjects()).toEqual(["chore: initial commit"])
  })
})

describe("the deprecated shipped base", () => {
  it("answers for a workflow named review only, mapping reviewBase", () => {
    expect(base("review", {})).toBe("")
    expect(base("review", { reviewBase: "v1" })).toBe("v1")
    expect(base("audit", { reviewBase: "v1" })).toBeUndefined()
  })
})
