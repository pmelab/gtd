import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as published from "./index.js"
import { BUILT_IN_MODE_NAMES, steeringFormatFor, unansweredQuestions, viewOf } from "./internal.js"

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

  it("lists the built-in mode names, in registry order", () => {
    expect(BUILT_IN_MODE_NAMES).toEqual(["qa", "review", "findings"])
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

describe("@pmelab/gtd/steering", () => {
  const internalOnly = [
    "FOOTNOTE_ACTION_TITLE",
    "THREAD_REPLY_ACTION_TITLE",
    "getParseCount",
    "BUILT_IN_MODE_NAMES",
    "steeringFormatOrFreeForm",
    "viewOf",
    "SteeringEditorView",
  ]

  it("marks every internal-use name deprecated, and still publishes it", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8")
    for (const name of internalOnly) {
      expect(source, name).toMatch(
        new RegExp(`/\\*\\* @deprecated [^\\n]*\\*/\\nexport (const|type) ${name} =`),
      )
    }
    expect(published.BUILT_IN_MODE_NAMES).toBe(BUILT_IN_MODE_NAMES)
    expect(published.viewOf).toBe(viewOf)
  })

  it("publishes the pure text reads a flow also has", () => {
    expect(published.sections("## A\n\n## B\n")).toEqual(["A", "B"])
    expect(typeof published.threads).toBe("function")
    expect(typeof published.openQuestions).toBe("function")
    expect(typeof published.sectionBodies).toBe("function")
  })
})
