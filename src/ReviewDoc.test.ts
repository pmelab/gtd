import { describe, expect, it } from "vitest"
import { parseReviewDoc, toggleFilePointer, REVIEW_FORMAT } from "./ReviewDoc.js"

describe("parseReviewDoc", () => {
  it("parses a well-formed review with one chunk, no explanations", () => {
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
            { path: "./src/calc.ts", line: 1, checked: false, sourceLine: 8, endLine: 8 },
            { path: "./src/calc.ts", line: 5, checked: false, sourceLine: 9, endLine: 9 },
          ],
        },
      ],
      errors: [],
    })
  })

  it("parses multiple chunks, checked boxes, and below-the-pointer explanations", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add calculator",
      "",
      "- [x] ./src/calc.ts#1",
      "  new add function",
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
            endLine: 6,
          },
        ],
      },
      {
        title: "Wire it up",
        headingLine: 8,
        description: "",
        files: [{ path: "./src/index.ts", line: 10, checked: false, sourceLine: 10, endLine: 10 }],
      },
    ])
  })

  it("gathers a multi-line explanation, joined with a single space", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1",
      "  first line of the explanation",
      "  second line of the explanation",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.files[0]).toEqual({
      path: "./src/calc.ts",
      line: 1,
      checked: false,
      note: "first line of the explanation second line of the explanation",
      sourceLine: 5,
      endLine: 7,
    })
  })

  it("parses the same note whether the continuation is indented or flush", () => {
    const indented = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1",
      "  what this hunk does",
      "",
    ].join("\n")
    const flush = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1",
      "what this hunk does",
      "",
    ].join("\n")
    expect(parseReviewDoc(indented).changesets[0]?.files[0]?.note).toBe("what this hunk does")
    expect(parseReviewDoc(flush).changesets[0]?.files[0]?.note).toBe("what this hunk does")
  })

  it("keeps a blank line between two continuation paragraphs inside the pointer's span, joining both", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1",
      "  first paragraph",
      "",
      "  second paragraph",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    const file = result.changesets[0]?.files[0]!
    expect(file.note).toBe("first paragraph second paragraph")
    expect(file.endLine).toBe(8)
  })

  it("a pointer with no explanation has endLine === sourceLine", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1",
      "- [ ] ./src/calc.ts#2",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    const [first, second] = result.changesets[0]!.files
    expect(first?.sourceLine).toBe(first?.endLine)
    expect(second?.sourceLine).toBe(second?.endLine)
  })

  it("trims trailing blank lines before the next '##' heading out of the last pointer's span", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1",
      "  the note",
      "",
      "",
      "## Next chunk",
      "",
      "- [ ] ./src/index.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.files[0]?.endLine).toBe(6)
  })

  it("puts lines before a chunk's first pointer into its description, and lines after a pointer into that pointer's note, not the description", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "Chunk-level prose, describing why the group exists.",
      "",
      "- [ ] ./src/calc.ts#1",
      "  This is the hunk's own note, not chunk prose.",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.description).toBe(
      "Chunk-level prose, describing why the group exists.",
    )
    expect(result.changesets[0]?.files[0]?.note).toBe(
      "This is the hunk's own note, not chunk prose.",
    )
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

  it("keeps a hyphenated path whole and its #line, instead of splitting at the first hyphen", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add budget alerts",
      "",
      "- [ ] ./src/server/email/budget-threshold.ts#31",
      "  non-obvious import: uses the shared mailer",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.errors).toEqual([])
    expect(result.changesets[0]?.files).toEqual([
      {
        path: "./src/server/email/budget-threshold.ts",
        line: 31,
        checked: false,
        note: "non-obvious import: uses the shared mailer",
        sourceLine: 5,
        endLine: 6,
      },
    ])
  })

  it("keeps a # not followed by digits in the path, with no line parsed", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./a#b.ts",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.files).toEqual([
      { path: "./a#b.ts", checked: false, sourceLine: 5, endLine: 5 },
    ])
  })

  it("still refuses a bare box, a non-./ path, and a ./ with nothing after it", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [] ./x.ts",
      "- [ ] src/no-dot-slash.ts",
      "- [ ] ./#31",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.files).toEqual([])
  })
})

describe("parseReviewDoc — a same-line note (trailing the pointer on its own line)", () => {
  it("parses as a pointer, with path, #line, and checked state intact, and the trailing text as its note", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add thing.ts",
      "",
      "- [x] ./src/Edge.ts#42 — what this hunk does",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.files[0]).toEqual({
      path: "./src/Edge.ts",
      line: 42,
      checked: true,
      note: "what this hunk does",
      sourceLine: 5,
      endLine: 5,
    })
  })

  it("produces zero validation errors for an ordinary same-line note", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add thing.ts",
      "",
      "- [ ] ./src/Edge.ts#42 — what this hunk does",
      "",
    ].join("\n")
    expect(REVIEW_FORMAT.validate(content)).toEqual([])
  })

  it("does not report 'no file pointers' for a chunk whose only pointer carries a same-line note", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add thing.ts",
      "",
      "- [ ] ./src/Edge.ts#42 — what this hunk does",
      "",
    ].join("\n")
    const errors = parseReviewDoc(content).errors
    expect(errors.some((e) => e.includes("no file pointers"))).toBe(false)
  })

  it("a hyphen inside a filename is never read as a separator — the separator is only recognized after whitespace splits it from the path", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./a-b/c-d.ts#7",
      "",
    ].join("\n")
    expect(REVIEW_FORMAT.validate(content)).toEqual([])
    expect(parseReviewDoc(content).changesets[0]?.files[0]?.path).toBe("./a-b/c-d.ts")
  })

  it("the clean below-the-pointer form still produces no errors", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/Edge.ts#42",
      "  what this hunk does",
      "",
    ].join("\n")
    expect(REVIEW_FORMAT.validate(content)).toEqual([])
  })

  it("strips an em dash, en dash, or hyphen run from the same-line segment, identical to the below-pointer stripping", () => {
    for (const dash of ["—", "–", "-", "---"]) {
      const content = [
        "# Review: abc1234",
        "<!-- base: abc1234def5678901234567890123456789abcd -->",
        "",
        "## Chunk",
        "",
        `- [ ] ./src/calc.ts#1 ${dash} the note`,
        "",
      ].join("\n")
      expect(parseReviewDoc(content).changesets[0]?.files[0]?.note).toBe("the note")
    }
  })

  it("joins a same-line segment with below-pointer lines, single space, same-line segment first", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1 — the same-line part",
      "  the below-pointer part",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.files[0]?.note).toBe("the same-line part the below-pointer part")
  })
})

describe("parseReviewDoc — a note starting with a second pointer is a positioned finding", () => {
  it("a same-line note whose first token is itself a pointer token yields one finding at the pointer's own sourceLine", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add thing.ts",
      "",
      "- [ ] ./a.ts#1 ./b.ts#2",
      "",
    ].join("\n")
    expect(REVIEW_FORMAT.validate(content)).toEqual([
      {
        message:
          'Chunk "Add thing.ts" hunk ./a.ts#1\'s note starts with a second pointer (./b.ts#2) — give it its own "- [ ]" line',
        line: 5,
      },
    ])
  })

  it("still fires when a separator sits between the two pointers, stripped before the check runs", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add thing.ts",
      "",
      "- [ ] ./a.ts#1 — ./b.ts#2",
      "",
    ].join("\n")
    expect(REVIEW_FORMAT.validate(content)).toEqual([
      {
        message:
          'Chunk "Add thing.ts" hunk ./a.ts#1\'s note starts with a second pointer (./b.ts#2) — give it its own "- [ ]" line',
        line: 5,
      },
    ])
  })

  it("does not fire for a below-pointer line opening with a bare path — only the same-line segment is checked", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1",
      "  ./src/foo.ts is the caller",
      "",
    ].join("\n")
    expect(REVIEW_FORMAT.validate(content)).toEqual([])
    expect(parseReviewDoc(content).changesets[0]?.files[0]?.note).toBe("./src/foo.ts is the caller")
  })

  it("does not fire for a same-line note whose first word merely contains a dot", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1 — e.g. this explains it",
      "",
    ].join("\n")
    expect(REVIEW_FORMAT.validate(content)).toEqual([])
  })

  it("does not fire for a bare './' token, reusing parseFilePointer's own minimum-path-length rule", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1 — ./ is not a real path",
      "",
    ].join("\n")
    expect(REVIEW_FORMAT.validate(content)).toEqual([])
  })
})

describe("parseReviewDoc — continuation-line dash stripping", () => {
  it("strips a leading em dash, en dash, or hyphen run from a continuation line", () => {
    for (const dash of ["—", "–", "-", "---"]) {
      const content = [
        "# Review: abc1234",
        "<!-- base: abc1234def5678901234567890123456789abcd -->",
        "",
        "## Chunk",
        "",
        "- [ ] ./src/calc.ts#1",
        `  ${dash} the note`,
        "",
      ].join("\n")
      expect(parseReviewDoc(content).changesets[0]?.files[0]?.note).toBe("the note")
    }
  })

  it("keeps a dash mid-sentence on a continuation line", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1",
      "  a note with a mid-sentence dash — kept",
      "",
    ].join("\n")
    expect(parseReviewDoc(content).changesets[0]?.files[0]?.note).toBe(
      "a note with a mid-sentence dash — kept",
    )
  })
})

const reviewDoc = [
  "# Review: abc1234",
  "<!-- base: abc1234def5678901234567890123456789abcd -->",
  "",
  "## Add calculator",
  "",
  "- [ ] ./src/calc.ts#1",
  "  add",
  "- [x] ./src/calc.ts#5",
  "  subtract",
  "",
  "## Wire it up",
  "",
  "- [ ] ./src/index.ts#10",
  "",
].join("\n")

describe("toggleFilePointer", () => {
  it("flips an unchecked box to checked without touching the rest of the line", () => {
    const lines = reviewDoc.split("\n")
    const edit = toggleFilePointer(reviewDoc, 5)
    expect(edit).toBeDefined()
    expect(lines[5]?.slice(edit!.range.start.character, edit!.range.end.character)).toBe(" ")
    expect(edit!.newText).toBe("x")
  })

  it("flips a checked box back to unchecked, preserving the pointer line exactly", () => {
    const edit = toggleFilePointer(reviewDoc, 7)
    expect(edit).toBeDefined()
    expect(edit!.newText).toBe(" ")
    const lines = reviewDoc.split("\n")
    const line = lines[7]!
    const patched =
      line.slice(0, edit!.range.start.character) +
      edit!.newText +
      line.slice(edit!.range.end.character)
    expect(patched).toBe("- [ ] ./src/calc.ts#5")
  })

  it("returns undefined for a line that isn't a file pointer", () => {
    expect(toggleFilePointer(reviewDoc, 3)).toBeUndefined()
  })

  it("still toggles a same-line-note pointer line, round-tripping the rest", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/server/email/budget-threshold.ts#31 — non-obvious import",
      "",
    ].join("\n")
    const line = content.split("\n")[5]!
    const edit = toggleFilePointer(content, 5)
    expect(edit).toBeDefined()
    const patched =
      line.slice(0, edit!.range.start.character) +
      edit!.newText +
      line.slice(edit!.range.end.character)
    expect(patched).toBe("- [x] ./src/server/email/budget-threshold.ts#31 — non-obvious import")
  })
})

describe("REVIEW_FORMAT", () => {
  it("validate delegates to the review findings, header/base-comment/no-chunks findings carrying no line", () => {
    expect(REVIEW_FORMAT.validate(reviewDoc)).toEqual([])
    expect(REVIEW_FORMAT.validate("Just some text\n")).toEqual([
      {
        message: "Missing or malformed '# Review: <hash>' header as the document's first line",
      },
      { message: "Missing '<!-- base: <hash> -->' comment" },
      { message: "REVIEW.md has no '##' chunks" },
    ])
  })

  it("no-file-pointers finding also carries no line", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add calculator",
      "",
      "Just prose, no pointers.",
      "",
    ].join("\n")
    expect(REVIEW_FORMAT.validate(content)).toEqual([
      { message: 'Chunk "Add calculator" has no file pointers' },
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

  it("actions offer a single-hunk toggle when the range sits on a hunk's pointer line", () => {
    const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } })
    const actions = REVIEW_FORMAT.actions(reviewDoc, at(5))
    expect(actions.map((a) => a.title)).toContain("gtd: check this hunk")
  })

  it("actions offer the SAME single-hunk toggle when the range sits on a continuation line below the pointer, and its edit targets the pointer line's own box", () => {
    const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } })
    const onPointer = REVIEW_FORMAT.actions(reviewDoc, at(5))
    const onContinuation = REVIEW_FORMAT.actions(reviewDoc, at(6))
    expect(onContinuation.map((a) => a.title)).toContain("gtd: check this hunk")
    const pointerEdit = onPointer.find((a) => a.title === "gtd: check this hunk")!.edits[0]!
    const continuationEdit = onContinuation.find((a) => a.title === "gtd: check this hunk")!
      .edits[0]!
    expect(continuationEdit).toEqual(pointerEdit)
    expect(continuationEdit.range.start.line).toBe(5)
  })

  it("actions still offer the toggle on a same-line-note pointer line", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1 — legacy note",
      "",
    ].join("\n")
    const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } })
    const actions = REVIEW_FORMAT.actions(content, at(5))
    expect(actions.map((a) => a.title)).toContain("gtd: check this hunk")
  })

  it("actions offer a whole-chunk toggle when the range sits on the chunk heading", () => {
    const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } })
    const actions = REVIEW_FORMAT.actions(reviewDoc, at(3))
    expect(actions.map((a) => a.title)).toContain('gtd: check all hunks in "Add calculator"')
  })

  it("pointerAt jumps to the hunk's file at its 1-based #line, mapped to a 0-based position", () => {
    const pointer = REVIEW_FORMAT.pointerAt?.(reviewDoc, 7)
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

  it("go-to-definition and the check/uncheck action DISAGREE at a continuation line: the action fires, go-to-definition does not — asserted at the SAME cursor position", () => {
    const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } })
    const continuationLine = 6 // "  add" — below "- [ ] ./src/calc.ts#1" at line 5
    expect(REVIEW_FORMAT.actions(reviewDoc, at(continuationLine)).map((a) => a.title)).toContain(
      "gtd: check this hunk",
    )
    expect(REVIEW_FORMAT.pointerAt?.(reviewDoc, continuationLine)).toBeUndefined()
  })

  it("pointerAt on a hyphenated hunk line returns the full path, not a truncated prefix", () => {
    const doc = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add budget alerts",
      "",
      "- [ ] ./src/server/email/budget-threshold.ts#31",
      "  non-obvious import",
    ].join("\n")
    expect(REVIEW_FORMAT.pointerAt?.(doc, 5)).toEqual({
      path: "./src/server/email/budget-threshold.ts",
      line: 30,
    })
  })
})

describe("voice styling (styled review exemplar)", () => {
  // Voice check (src/workflows/unified.yaml's styleBlock): blunt, imperative
  // sentences, bold carrying the actual claim, no throat-clearing preamble.
  // This proves the parser cares only about the header/marker/heading/pointer
  // grammar, never the prose register wrapped around it.
  const styledReview = [
    "# Review: 9f3a21c",
    "",
    "<!-- base: 9f3a21cf8b4d5e6a7b8c9d0e1f2a3b4c5d6e7f80 -->",
    "",
    "## Add token-bucket limiter",
    "",
    "**The bucket refills at a fixed rate; it never bursts past its cap.**",
    "This is the only algorithm change in the batch — everything else below",
    "is wiring.",
    "",
    "- [ ] ./src/RateLimiter.ts#12",
    "  Refill math. Check the rounding direction.",
    "- [ ] ./src/RateLimiter.ts#48",
    "  Cap enforcement on a burst request.",
    "",
    "## Wire the limiter into the API gateway",
    "",
    "**Every unauthenticated route resolves a limiter before its handler runs.**",
    "Authenticated routes keep a separate, higher-ceiling bucket keyed by",
    "account id.",
    "",
    "- [ ] ./src/Gateway.ts#101",
    "- [ ] ./src/Gateway.ts#134",
    "  Account-keyed bucket lookup.",
    "",
  ].join("\n")

  it("parses with zero validation errors", () => {
    expect(REVIEW_FORMAT.validate(styledReview)).toEqual([])
  })

  it("recognizes every chunk heading and file-pointer row", () => {
    const { changesets } = parseReviewDoc(styledReview)
    expect(changesets.map((c) => c.title)).toEqual([
      "Add token-bucket limiter",
      "Wire the limiter into the API gateway",
    ])
    expect(changesets[0]!.files.map((f) => [f.path, f.line])).toEqual([
      ["./src/RateLimiter.ts", 12],
      ["./src/RateLimiter.ts", 48],
    ])
    expect(changesets[1]!.files.map((f) => [f.path, f.line])).toEqual([
      ["./src/Gateway.ts", 101],
      ["./src/Gateway.ts", 134],
    ])
  })
})

describe("REVIEW_FORMAT.actions — cursor geometry (hunk and chunk span boundaries)", () => {
  // Three chunks: A has a hunk with a multi-line note (sourceLine !== endLine)
  // followed by a plain hunk, B has zero file pointers, C is the last chunk
  // (exercises the `?? lines.length` fallback for the chunk-end computation).
  const geoDoc = [
    "# Review: abc1234", // 0
    "<!-- base: abc1234def5678901234567890123456789abcd -->", // 1
    "", // 2
    "## Chunk A", // 3
    "", // 4
    "- [ ] ./src/a.ts#1", // 5
    "  first line note", // 6
    "  second line note", // 7
    "", // 8
    "- [x] ./src/a.ts#5", // 9
    "", // 10
    "## Chunk B", // 11
    "", // 12
    "Just prose, no pointers.", // 13
    "", // 14
    "## Chunk C", // 15
    "", // 16
    "- [ ] ./src/c.ts#1", // 17
    "", // 18
  ].join("\n")

  const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } })
  const titles = (line: number) => REVIEW_FORMAT.actions(geoDoc, at(line)).map((a) => a.title)

  it.each([
    [5, true, "gtd: check this hunk", "hunk 1's own sourceLine"],
    [7, true, "gtd: check this hunk", "hunk 1's endLine (multi-line note, endLine > sourceLine)"],
    [8, false, "gtd: check this hunk", "one line past hunk 1's endLine"],
    [9, true, "gtd: uncheck this hunk", "hunk 2, where sourceLine === endLine"],
  ])("hunk action at line %i — offered: %s (%s / %s)", (line, expected, title) => {
    const t = titles(line)
    if (expected) expect(t).toContain(title)
    else expect(t).not.toContain(title)
  })

  it.each([
    [3, true, "Chunk A's headingLine"],
    [10, true, "Chunk A's computed end (last line before Chunk B's heading)"],
    [11, false, "one line past Chunk A's end (Chunk B's headingLine)"],
  ])("chunk A action at line %i — offered: %s (%s)", (line, expected) => {
    const t = titles(line)
    const title = 'gtd: check all hunks in "Chunk A"'
    if (expected) expect(t).toContain(title)
    else expect(t).not.toContain(title)
  })

  it.each([
    [15, true, "Chunk C's headingLine (last chunk)"],
    [18, true, "Chunk C's computed end (last line of the doc, no next chunk)"],
    [19, false, "one line past Chunk C's end (past the document)"],
  ])("chunk C action at line %i — offered: %s (%s)", (line, expected) => {
    const t = titles(line)
    const title = 'gtd: check all hunks in "Chunk C"'
    if (expected) expect(t).toContain(title)
    else expect(t).not.toContain(title)
  })

  it("offers no chunk action anywhere inside Chunk B, which has zero file pointers", () => {
    for (const line of [11, 12, 13, 14]) {
      const t = titles(line)
      expect(t.some((title) => title.includes("Chunk B"))).toBe(false)
    }
  })
})

describe("REVIEW_FORMAT.outline — last-chunk end-of-range fallback", () => {
  const threeChunkLines = (trailingNewline: boolean) => {
    const lines = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk One",
      "",
      "- [ ] ./src/a.ts#1",
      "",
      "## Chunk Two",
      "",
      "- [ ] ./src/b.ts#1",
      "",
      "## Chunk Three",
      "",
      "- [ ] ./src/c.ts#1",
    ]
    return (trailingNewline ? [...lines, ""] : lines).join("\n")
  }

  it("the last chunk's outline range ends at the document's last line when the doc has a trailing newline", () => {
    const content = threeChunkLines(true)
    const nodes = REVIEW_FORMAT.outline(content)
    const last = nodes[nodes.length - 1]!
    expect(last.name).toBe("Chunk Three (0/1)")
    expect(last.range.end.line).toBe(14)
  })

  it("the last chunk's outline range still ends correctly when the doc has NO trailing newline", () => {
    const content = threeChunkLines(false)
    const nodes = REVIEW_FORMAT.outline(content)
    const last = nodes[nodes.length - 1]!
    expect(last.name).toBe("Chunk Three (0/1)")
    expect(last.range.end.line).toBe(13)
  })
})

describe("REVIEW_FORMAT.actions — chunk-toggle majority rule (even split checks)", () => {
  const chunkWithCheckedCount = (checkedCount: number) => {
    const box = (i: number) => (i < checkedCount ? "x" : " ")
    return [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Four hunks",
      "",
      `- [${box(0)}] ./src/a.ts#1`,
      `- [${box(1)}] ./src/a.ts#2`,
      `- [${box(2)}] ./src/a.ts#3`,
      `- [${box(3)}] ./src/a.ts#4`,
      "",
    ].join("\n")
  }

  const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } })

  it.each([
    [1, 'gtd: check all hunks in "Four hunks"', "1 of 4 checked — minority, checks"],
    [2, 'gtd: check all hunks in "Four hunks"', "2 of 4 checked — even split, checks"],
    [3, 'gtd: uncheck all hunks in "Four hunks"', "3 of 4 checked — strict majority, unchecks"],
  ])("with %i of 4 hunks checked, the chunk action is %j (%s)", (checkedCount, expectedTitle) => {
    const content = chunkWithCheckedCount(checkedCount)
    const titles = REVIEW_FORMAT.actions(content, at(3)).map((a) => a.title)
    expect(titles).toContain(expectedTitle)
  })
})

describe("ReviewDoc — LF/CRLF produce identical results", () => {
  const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } })

  it("parseReviewDoc, outline, and actions are unaffected by CRLF line endings", () => {
    const crlfDoc = reviewDoc.replaceAll("\n", "\r\n")
    expect(parseReviewDoc(crlfDoc)).toEqual(parseReviewDoc(reviewDoc))
    expect(REVIEW_FORMAT.outline(crlfDoc)).toEqual(REVIEW_FORMAT.outline(reviewDoc))
    const lfActions = REVIEW_FORMAT.actions(reviewDoc, at(3))
    const crlfActions = REVIEW_FORMAT.actions(crlfDoc, at(3))
    expect(lfActions.length).toBeGreaterThan(0)
    expect(crlfActions).toEqual(lfActions)
  })
})

describe("ReviewDoc — inline-segment whitespace splitting", () => {
  it("a second-pointer separated by two-or-more spaces is detected identically to a single space", () => {
    const build = (gap: string) =>
      [
        "# Review: abc1234",
        "<!-- base: abc1234def5678901234567890123456789abcd -->",
        "",
        "## Add thing.ts",
        "",
        `- [ ] ./a.ts#1${gap}./b.ts#2`,
        "",
      ].join("\n")
    const singleSpace = build(" ")
    const multiSpace = build("   ")
    expect(REVIEW_FORMAT.validate(multiSpace)).toEqual(REVIEW_FORMAT.validate(singleSpace))
    expect(REVIEW_FORMAT.validate(singleSpace)).toEqual([
      {
        message:
          'Chunk "Add thing.ts" hunk ./a.ts#1\'s note starts with a second pointer (./b.ts#2) — give it its own "- [ ]" line',
        line: 5,
      },
    ])
  })
})

describe("ReviewDoc — load-bearing whitespace trims", () => {
  it("trims leading/trailing whitespace off the header line before matching it", () => {
    const content = [
      "   # Review: abc1234   ",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/x.ts#1",
      "",
    ].join("\n")
    expect(parseReviewDoc(content).shortHash).toBe("abc1234")
  })

  it("skips a whitespace-only line before the header when finding the first non-blank line", () => {
    const content = [
      "   ",
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/x.ts#1",
      "",
    ].join("\n")
    expect(parseReviewDoc(content).shortHash).toBe("abc1234")
  })

  it("treats a whitespace-only line as blank inside a pointer's span, not as a break or as note content", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1",
      "  first paragraph",
      "   ",
      "  second paragraph",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    const file = result.changesets[0]?.files[0]!
    expect(file.note).toBe("first paragraph second paragraph")
    expect(file.endLine).toBe(8)
  })

  it("treats a whitespace-only line as blank when it is the LAST line of a pointer's span", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#1",
      "  a note",
      "   ",
      "- [ ] ./src/calc.ts#9",
    ].join("\n")
    const result = parseReviewDoc(content)
    const file = result.changesets[0]?.files[0]!
    expect(file.endLine).toBe(6)
  })

  it("trims leading/trailing whitespace off a chunk's description line", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "   Indented chunk prose.   ",
      "",
      "- [ ] ./src/calc.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.description).toBe("Indented chunk prose.")
  })

  it("computes the toggle's character offset correctly for an indented pointer line", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "  - [ ] ./src/x.ts#1",
      "",
    ].join("\n")
    const line = content.split("\n")[5]!
    const edit = toggleFilePointer(content, 5)
    expect(edit).toBeDefined()
    expect(line.slice(edit!.range.start.character, edit!.range.end.character)).toBe(" ")
    expect(edit!.newText).toBe("x")
    expect(edit!.range.start.character).toBe(5)
  })
})
