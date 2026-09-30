import { describe, expect, it } from "vitest"
import { BUILT_IN_MODE_NAMES, steeringFormatFor, unansweredQuestions, viewOf } from "./index.js"

const qa = steeringFormatFor("qa")!
const review = steeringFormatFor("review")!

describe("steeringFormatFor / BUILT_IN_MODE_NAMES", () => {
  it("resolves both built-in modes by name", () => {
    expect(steeringFormatFor("qa")).toBeDefined()
    expect(steeringFormatFor("review")).toBeDefined()
  })

  it("is undefined for a name that isn't a built-in mode", () => {
    expect(steeringFormatFor("bogus")).toBeUndefined()
  })

  it("lists both built-in mode names, in registry order", () => {
    expect(BUILT_IN_MODE_NAMES).toEqual(["qa", "review"])
  })
})

describe("dispatch over a resolved format — cross-format safety", () => {
  it("each registered format validates with its own rule, not a shared or wrong one", () => {
    expect(qa.validate("")).toEqual([])
    expect(review.validate("").length).toBeGreaterThan(0)
  })

  it("unansweredQuestions is qa-only — review always answers []", () => {
    expect(unansweredQuestions(review, review.sample)).toEqual([])
  })

  it("clearTicks is format-parameterised — running review's clearTicks over qa-shaped content is a no-op", () => {
    const qaShapedContent = [
      "Plan.",
      "",
      "## Open Questions",
      "",
      "### Q?",
      "",
      "- [x] Option A",
      "- [ ] Option B",
      "",
    ].join("\n")
    expect(qa.clearTicks(qaShapedContent)).toBe(qaShapedContent)
    expect(review.clearTicks(qaShapedContent)).toBe(qaShapedContent)
  })
})

describe("viewOf", () => {
  it("qa's view has no documentLinks (qa declares none) but does have an outline", () => {
    const view = viewOf(qa, qa.sample)
    expect(view.documentLinks).toEqual([])
    expect(view.outline.length).toBeGreaterThan(0)
  })

  it("review's documentLinks carry the hunk pointer's own range, matching its outline's hunk-adjacent chunk range", () => {
    const view = viewOf(review, review.sample)
    expect(view.documentLinks.length).toBe(1)
    expect(view.documentLinks[0]!.path).toBe("./sample.ts")
    expect(view.documentLinks[0]!.line).toBe(0)
  })
})
