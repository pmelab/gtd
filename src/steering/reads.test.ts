import { describe, expect, it } from "vitest"
import { sectionBodies, sections } from "./reads.js"

describe("the pure text reads", () => {
  it("sections and sectionBodies read the top-level ## headings", () => {
    const text = "# Title\n\n## One\n\nfirst\n\n### Sub\n\n## Two\n"
    expect(sections(text)).toEqual(["One", "Two"])
    expect(sectionBodies(text).map((s) => s.title)).toEqual(["One", "Two"])
    expect(sectionBodies(text)[0]!.body).toContain("## One")
  })

  it("works outside a replay", () => {
    expect(() => sections("")).not.toThrow()
  })
})
