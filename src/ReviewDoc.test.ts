import { describe, expect, it } from "vitest"
import { parseReviewDoc } from "./ReviewDoc.js"

describe("parseReviewDoc", () => {
  it("parses a well-formed review with one chunk", () => {
    const content = [
      "# Review: abc1234",
      "",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add calculator",
      "",
      "New add function for the calculator.",
      "",
      "- [ ] ./src/calc.ts#1",
      "- [ ] ./src/calc.ts#5",
      "",
    ].join("\n")

    expect(parseReviewDoc(content)).toEqual({
      shortHash: "abc1234",
      fullHash: "abc1234def5678901234567890123456789abcd",
      changesets: [
        {
          title: "Add calculator",
          description: "New add function for the calculator.",
          files: [
            { path: "./src/calc.ts", line: 1, checked: false },
            { path: "./src/calc.ts", line: 5, checked: false },
          ],
        },
      ],
      errors: [],
    })
  })

  it("parses multiple chunks, checked boxes, and trailing notes", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add calculator",
      "",
      "- [x] ./src/calc.ts#1 — new add function",
      "",
      "## Wire it up",
      "",
      "- [ ] ./src/index.ts#10",
      "",
    ].join("\n")

    const result = parseReviewDoc(content)
    expect(result.errors).toEqual([])
    expect(result.changesets).toEqual([
      {
        title: "Add calculator",
        description: "",
        files: [{ path: "./src/calc.ts", line: 1, checked: true, note: "new add function" }],
      },
      {
        title: "Wire it up",
        description: "",
        files: [{ path: "./src/index.ts", line: 10, checked: false }],
      },
    ])
  })

  it("errors when the header is missing", () => {
    const content = [
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add calculator",
      "",
      "- [ ] ./src/calc.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.shortHash).toBeUndefined()
    expect(result.errors).toContain(
      "Missing or malformed '# Review: <hash>' header as the document's first line",
    )
  })

  it("errors when the base comment is missing", () => {
    const content = [
      "# Review: abc1234",
      "",
      "## Add calculator",
      "",
      "- [ ] ./src/calc.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.fullHash).toBeUndefined()
    expect(result.errors).toContain("Missing '<!-- base: <hash> -->' comment")
  })

  it("errors when a chunk has no file pointers", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add calculator",
      "",
      "Just prose, no pointers.",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.errors).toContain('Chunk "Add calculator" has no file pointers')
    expect(result.changesets).toEqual([
      { title: "Add calculator", description: "Just prose, no pointers.", files: [] },
    ])
  })

  it("errors when there are no chunks at all", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "Nothing to review.",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.errors).toContain("REVIEW.md has no '##' chunks")
    expect(result.changesets).toEqual([])
  })

  it("collects all applicable errors at once for a fully malformed document", () => {
    const result = parseReviewDoc("Just some text\n")
    expect(result.errors).toEqual([
      "Missing or malformed '# Review: <hash>' header as the document's first line",
      "Missing '<!-- base: <hash> -->' comment",
      "REVIEW.md has no '##' chunks",
    ])
  })
})
