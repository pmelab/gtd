import { describe, expect, it } from "vitest"
import * as published from "./index.js"
import { viewOf, widgetFormat } from "./internal.js"

describe("viewOf", () => {
  it("gives the widget format's outline and hunk links", () => {
    const view = viewOf(widgetFormat, "## 🔍 Chunk\n\n- [ ] ./a.ts#3-4\n")
    expect(view.outline.map((n) => n.name)).toEqual(["🔍 Chunk"])
    expect(view.documentLinks.map((l) => [l.path, l.line])).toEqual([["a.ts", 2]])
  })
})

describe("@pmelab/gtd/steering", () => {
  it("publishes no engine-only name", () => {
    for (const name of [
      "getParseCount",
      "viewOf",
      "headingSections",
      "headingSectionBodies",
      "steeringStepFindings",
      "steeringPreamble",
    ]) {
      expect(published, name).not.toHaveProperty(name)
    }
  })

  it("publishes the pure text reads a flow also has", () => {
    expect(published.sections("## A\n\n## B\n")).toEqual(["A", "B"])
    expect(typeof published.sectionBodies).toBe("function")
  })
})
