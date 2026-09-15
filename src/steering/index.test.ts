import { describe, expect, it } from "vitest"
import {
  builtInModeNames,
  checkSteering,
  clearTicks,
  steeringFormatFor,
  unansweredQuestions,
  viewOf,
} from "./index.js"

const qa = steeringFormatFor("qa")!
const review = steeringFormatFor("review")!

describe("steeringFormatFor / builtInModeNames", () => {
  it("resolves both built-in modes by name", () => {
    expect(steeringFormatFor("qa")).toBeDefined()
    expect(steeringFormatFor("review")).toBeDefined()
  })

  it("is undefined for a name that isn't a built-in mode", () => {
    expect(steeringFormatFor("bogus")).toBeUndefined()
  })

  it("lists both built-in mode names, in registry order", () => {
    expect(builtInModeNames()).toEqual(["qa", "review"])
  })

  it("each built-in format's own sample validates clean (zero findings)", () => {
    for (const name of builtInModeNames()) {
      const format = steeringFormatFor(name)!
      expect(checkSteering(format, format.sample)).toEqual([])
    }
  })
})

describe("dispatch over a resolved format — cross-format safety", () => {
  it("checkSteering routes to the resolved format's own validate, not a shared or wrong one", () => {
    expect(checkSteering(qa, "")).toEqual([])
    expect(checkSteering(review, "").length).toBeGreaterThan(0)
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
    expect(clearTicks(qa, qaShapedContent)).toBe(qaShapedContent)
    expect(clearTicks(review, qaShapedContent)).toBe(qaShapedContent)
  })
})

describe("viewOf", () => {
  it("returns one value carrying outline, documentLinks, pointerAt, and actionsAt together", () => {
    const view = viewOf(review, review.sample)
    expect(Array.isArray(view.outline)).toBe(true)
    expect(Array.isArray(view.documentLinks)).toBe(true)
    expect(typeof view.pointerAt).toBe("function")
    expect(typeof view.actionsAt).toBe("function")
  })

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

  it("actionsAt returns the same actions the underlying format.actions would, for a range", () => {
    const range = { start: { line: 6, character: 0 }, end: { line: 6, character: 0 } }
    const view = viewOf(review, review.sample)
    expect(view.actionsAt(range)).toEqual(review.actions(review.sample, range))
  })

  it("pointerAt returns the same pointer the underlying format.pointerAt would, for a position", () => {
    const position = { line: 6, character: 8 } // inside the hunk's pointer token
    const view = viewOf(review, review.sample)
    expect(view.pointerAt(position)).toEqual(review.pointerAt?.(review.sample, position))
  })
})
