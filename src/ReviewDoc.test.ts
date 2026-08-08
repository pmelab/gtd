import { describe, expect, it } from "vitest"
import { parseReviewDoc, untickedFiles, toggleFilePointer, REVIEW_FORMAT } from "./ReviewDoc.js"

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
          headingLine: 4,
          description: "New add function for the calculator.",
          files: [
            { path: "./src/calc.ts", line: 1, checked: false, sourceLine: 8 },
            { path: "./src/calc.ts", line: 5, checked: false, sourceLine: 9 },
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
        headingLine: 3,
        description: "",
        files: [
          {
            path: "./src/calc.ts",
            line: 1,
            checked: true,
            note: "new add function",
            sourceLine: 5,
          },
        ],
      },
      {
        title: "Wire it up",
        headingLine: 7,
        description: "",
        files: [{ path: "./src/index.ts", line: 10, checked: false, sourceLine: 9 }],
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
      {
        title: "Add calculator",
        headingLine: 3,
        description: "Just prose, no pointers.",
        files: [],
      },
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

const reviewDoc = [
  "# Review: abc1234",
  "<!-- base: abc1234def5678901234567890123456789abcd -->",
  "",
  "## Add calculator",
  "",
  "- [ ] ./src/calc.ts#1",
  "- [x] ./src/calc.ts#5 — subtract",
  "",
  "## Wire it up",
  "",
  "- [ ] ./src/index.ts#10",
  "",
].join("\n")

describe("untickedFiles", () => {
  it("returns every unticked pointer across all chunks", () => {
    expect(untickedFiles(reviewDoc).map((f) => f.path)).toEqual(["./src/calc.ts", "./src/index.ts"])
  })

  it("returns an empty array when every pointer is ticked", () => {
    const allChecked = reviewDoc.replace("- [ ] ./src/calc.ts#1", "- [x] ./src/calc.ts#1")
    expect(untickedFiles(allChecked).filter((f) => f.path === "./src/calc.ts")).toEqual([])
  })
})

describe("toggleFilePointer", () => {
  it("flips an unchecked box to checked without touching the rest of the line", () => {
    const lines = reviewDoc.split("\n")
    const edit = toggleFilePointer(reviewDoc, 5)
    expect(edit).toBeDefined()
    expect(lines[5]?.slice(edit!.range.start.character, edit!.range.end.character)).toBe(" ")
    expect(edit!.newText).toBe("x")
  })

  it("flips a checked box back to unchecked, preserving the trailing note", () => {
    const edit = toggleFilePointer(reviewDoc, 6)
    expect(edit).toBeDefined()
    expect(edit!.newText).toBe(" ")
    const lines = reviewDoc.split("\n")
    const line = lines[6]!
    const patched =
      line.slice(0, edit!.range.start.character) +
      edit!.newText +
      line.slice(edit!.range.end.character)
    expect(patched).toBe("- [ ] ./src/calc.ts#5 — subtract")
  })

  it("returns undefined for a line that isn't a file pointer", () => {
    expect(toggleFilePointer(reviewDoc, 3)).toBeUndefined()
  })
})

describe("REVIEW_FORMAT", () => {
  it("validate delegates to parseReviewDoc's errors", () => {
    expect(REVIEW_FORMAT.validate(reviewDoc)).toEqual([])
    expect(REVIEW_FORMAT.validate("Just some text\n")).toEqual([
      "Missing or malformed '# Review: <hash>' header as the document's first line",
      "Missing '<!-- base: <hash> -->' comment",
      "REVIEW.md has no '##' chunks",
    ])
  })

  it("outline emits only headlines of chunks with an unchecked hunk, no children", () => {
    const nodes = REVIEW_FORMAT.outline(reviewDoc)
    expect(nodes.map((n) => n.name)).toEqual(["Add calculator (1/2)", "Wire it up (0/1)"])
    expect(nodes[0]?.children).toBeUndefined()
    expect(nodes[0]?.leaf).toBeUndefined()
    expect(nodes[0]?.selectionRange.start.line).toBe(3)
  })

  it("outline omits a fully-checked chunk's headline", () => {
    const doc = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## All done",
      "",
      "- [x] ./src/calc.ts#1",
      "",
      "## Still open",
      "",
      "- [ ] ./src/index.ts#10",
      "",
    ].join("\n")
    expect(REVIEW_FORMAT.outline(doc).map((n) => n.name)).toEqual(["Still open (0/1)"])
  })

  it("actions offer a single-hunk toggle when the range sits on a hunk line", () => {
    const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } })
    const actions = REVIEW_FORMAT.actions(reviewDoc, at(5))
    expect(actions.map((a) => a.title)).toContain("gtd: check this hunk")
  })

  it("actions offer a whole-chunk toggle when the range sits on the chunk heading", () => {
    const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } })
    const actions = REVIEW_FORMAT.actions(reviewDoc, at(3))
    expect(actions.map((a) => a.title)).toContain('gtd: check all hunks in "Add calculator"')
  })

  it("pointerAt jumps to the hunk's file at its 1-based #line, mapped to a 0-based position", () => {
    const pointer = REVIEW_FORMAT.pointerAt?.(reviewDoc, 6)
    expect(pointer).toEqual({ path: "./src/calc.ts", line: 4 })
  })

  it("pointerAt lands at line 0 for a bare ./path with no #line", () => {
    const doc = [
      "# Review: abc1234",
      "<!-- base: abc -->",
      "",
      "## C",
      "",
      "- [ ] ./src/bare.ts",
    ].join("\n")
    expect(REVIEW_FORMAT.pointerAt?.(doc, 5)).toEqual({ path: "./src/bare.ts", line: 0 })
  })

  it("pointerAt returns undefined when the line is not a hunk pointer", () => {
    expect(REVIEW_FORMAT.pointerAt?.(reviewDoc, 3)).toBeUndefined() // "## Add calculator"
  })
})
