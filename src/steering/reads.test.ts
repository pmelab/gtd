import { describe, expect, it } from "vitest"
import { openQuestions, sectionBodies, sections, threads } from "./reads.js"

describe("the pure text reads", () => {
  it("sections and sectionBodies read the top-level ## headings", () => {
    const text = "# Title\n\n## One\n\nfirst\n\n### Sub\n\n## Two\n"
    expect(sections(text)).toEqual(["One", "Two"])
    expect(sectionBodies(text).map((s) => s.title)).toEqual(["One", "Two"])
    expect(sectionBodies(text)[0]!.body).toContain("## One")
  })

  it("openQuestions lists a qa document's unanswered questions with 1-based lines", () => {
    const text = [
      "## Open Questions",
      "",
      "### Which database?",
      "",
      "- [ ] Postgres",
      "- [ ] SQLite",
      "",
    ].join("\n")
    expect(openQuestions(text)).toEqual([{ question: "Which database?", line: 3 }])
  })

  it("threads reads a footnote thread with its 1-based line and who it waits on", () => {
    const text = [
      "We cache it.[^cache]",
      "",
      "[^cache]:",
      "    - H: why?",
      "    - A: because",
      "",
    ].join("\n")
    expect(threads(text)).toEqual([{ name: "cache", line: 3, waitingOn: "human", faults: [] }])
  })

  it("works outside a replay", () => {
    expect(() => sections("")).not.toThrow()
    expect(threads("no threads here")).toEqual([])
    expect(openQuestions("")).toEqual([])
  })
})
