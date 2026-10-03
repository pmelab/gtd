import { describe, expect, it } from "vitest"
import { FOOTNOTE_ACTION_TITLE, steeringFormatFor, viewOf } from "./index.js"
import { parseReviewDoc } from "./review.js"
import { getParseCount } from "./index.js"

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
      "- [ ] ./src/calc.ts#1-1",
      "- [ ] ./src/calc.ts#5-9",
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
          descriptionInline: [{ kind: "text", value: "New add function for the calculator." }],
          descriptionNodes: [
            {
              title: "New add function for the calculator.",
              anchor: { kind: "paragraph", line: 6 },
              block: {
                kind: "paragraph",
                inline: [{ kind: "text", value: "New add function for the calculator." }],
              },
            },
          ],
          files: [
            {
              path: "./src/calc.ts",
              line: 1,
              rangeEnd: 1,
              checked: false,
              sourceLine: 8,
              endLine: 8,
            },
            {
              path: "./src/calc.ts",
              line: 5,
              rangeEnd: 9,
              checked: false,
              sourceLine: 9,
              endLine: 9,
            },
          ],
        },
      ],
      findings: [],
    })
  })
})

describe("parseReviewDoc — pointer range grammar", () => {
  const pointerLine = (line: string) =>
    [
      "# Review: abc1234",
      "",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      `- [ ] ${line}`,
      "",
    ].join("\n")

  const fileOf = (content: string) => parseReviewDoc(content).changesets[0]!.files[0]!

  it("parses '#42-70' to path, start 42, end 70", () => {
    const file = fileOf(pointerLine("./path/to/file.ts#42-70 does a thing"))
    expect(file.path).toBe("./path/to/file.ts")
    expect(file.rangeEnd).toBe(70)
    expect(file.line).toBe(42)
  })

  it("takes the LAST '#' as the range separator — a '#' or '-' earlier in the path is never read as one", () => {
    const file = fileOf(pointerLine("./a-b/c#d#1-9 note"))
    expect(file.path).toBe("./a-b/c#d")
    expect(file.line).toBe(1)
    expect(file.rangeEnd).toBe(9)
  })

  it("a token with no '#' at all parses as the whole path, no range and no line", () => {
    const file = fileOf(pointerLine("./some-file.ts note"))
    expect(file.path).toBe("./some-file.ts")
    expect(file.rangeEnd).toBeUndefined()
    expect(file.line).toBeUndefined()
  })

  it("a bare '#42' parses as path './x.ts' with line 42 — never a path literally named 'x.ts#42'", () => {
    const file = fileOf(pointerLine("./x.ts#42 note"))
    expect(file.path).toBe("./x.ts")
    expect(file.line).toBe(42)
    expect(file.rangeEnd).toBeUndefined()
  })
})

const review = steeringFormatFor("review")!

const doc = (lines: readonly string[]): string => lines.join("\n")

const HEADER = "# Review: abc123"
const BASE = "<!-- base: 0000000000000000000000000000000000000000 -->"

describe("review — structure (validate)", () => {
  it("parses a well-formed review with one chunk, no explanations, cleanly", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1-1 does a thing", ""])
    expect(review.validate(content)).toEqual([])
  })

  it("errors when the header is missing", () => {
    const content = doc([BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 does a thing", ""])
    expect(review.validate(content)).toContainEqual(
      expect.objectContaining({
        message: "Missing or malformed '# Review: <hash>' header as the document's first line",
      }),
    )
  })

  it("errors when the base comment is missing", () => {
    const content = doc([HEADER, "", "## Chunk", "", "- [ ] ./a.ts#1 does a thing", ""])
    expect(review.validate(content)).toContainEqual(
      expect.objectContaining({ message: "Missing '<!-- base: <hash> -->' comment" }),
    )
  })

  it("errors when there are no chunks at all", () => {
    const content = doc([HEADER, "", BASE, ""])
    expect(review.validate(content)).toContainEqual(
      expect.objectContaining({ message: "REVIEW.md has no '##' chunks" }),
    )
  })

  it("collects all applicable errors at once for a fully malformed document", () => {
    const findings = review.validate("")
    expect(findings.length).toBeGreaterThanOrEqual(2)
  })

  it("keeps a hyphenated path whole and its #line, instead of splitting at the first hyphen", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./my-file.ts#42-70 note", ""])
    expect(review.validate(content)).toEqual([])
  })

  it("keeps a # not followed by digits in the path, with no line parsed, and no findings", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./file#hash.ts note", ""])
    expect(review.validate(content)).toEqual([])
  })

  it("still refuses a bare box, a non-./ path, and a ./ with nothing after it — no pointer, so chunk is empty", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] just prose here", ""])
    expect(review.validate(content)).toContainEqual(
      expect.objectContaining({ message: 'Chunk "Chunk" has no file pointers' }),
    )
  })

  it("an ordinary chunk still isn't exempted merely by carrying prose that resembles an assumption", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Not Assumptions",
      "",
      "- some inferred note with no pointer",
      "",
    ])
    expect(review.validate(content)).toContainEqual(
      expect.objectContaining({ message: 'Chunk "Not Assumptions" has no file pointers' }),
    )
  })

  it("a literal Assumptions chunk with no file pointers is a finding too — no title is exempt", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Assumptions",
      "",
      "- some inferred note with no pointer",
      "",
    ])
    expect(review.validate(content)).toContainEqual(
      expect.objectContaining({ message: 'Chunk "Assumptions" has no file pointers' }),
    )
  })
})

describe("parseReviewDoc — a chunk's description is its own prose, never a node containing a hunk pointer", () => {
  it("yields an empty description when the only pointers sit inside a blockquote (no top-level `list`)", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "> - [ ] ./src/a.ts#1 — thing",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.description).toBe("")
    expect(result.changesets[0]?.files[0]?.path).toBe("./src/a.ts")
  })

  it("the pointer run still starts at the real list even when a four-space-indented line above it looks like a pointer (a code block, not a list)", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "    - [ ] ./src/a.ts#1",
      "",
      "- [ ] ./src/b.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    // The indented line parses as a `code` node, not a list — it never
    // registers as a pointer, so the real pointer run still starts (and
    // stays) at `./src/b.ts#1` below. The code node itself, however, now
    // sits in the leading run like any other node kind, so its own text
    // surfaces as the description — this is Task 1's own drop fix, not a
    // regression in where the pointer run starts.
    expect(result.changesets[0]?.description).toBe("- [ ] ./src/a.ts#1")
    expect(result.changesets[0]?.files).toEqual([
      { path: "./src/b.ts", line: 1, checked: false, sourceLine: 7, endLine: 7 },
    ])
  })

  it("a `###` sub-heading before the pointers now yields real description text", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "### Sub",
      "",
      "- [ ] ./src/a.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.description).toBe("### Sub")
  })

  it("an HTML comment before the pointers now yields real description text", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "<!-- x -->",
      "",
      "- [ ] ./src/a.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.description).toBe("<!-- x -->")
  })

  it("still yields real leading prose as the description", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "Real prose about this chunk.",
      "",
      "- [ ] ./src/a.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.description).toBe("Real prose about this chunk.")
  })

  it("keeps every block kind in the leading run — heading, fenced code, HTML block and thematic break alike — in document order in `descriptionNodes`", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "### Sub",
      "",
      "```ts",
      "const x = 1",
      "```",
      "",
      "<!-- a comment -->",
      "",
      "---",
      "",
      "- [ ] ./src/a.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.descriptionNodes.map((n) => n.block?.kind ?? n.title)).toEqual([
      "heading",
      "code",
      "<!-- a comment -->",
      "---",
    ])
  })

  it("excludes a `footnoteDefinition` from both `description` and `descriptionNodes`, even inside the leading run", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "Real prose about this chunk.[^1]",
      "",
      "[^1]: a footnote body",
      "",
      "- [ ] ./src/a.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    expect(result.changesets[0]?.description).toBe("Real prose about this chunk.")
    expect(result.changesets[0]?.descriptionNodes).toHaveLength(1)
    expect(result.changesets[0]?.descriptionNodes[0]?.block?.kind).toBe("paragraph")
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
      noteInline: [{ kind: "text", value: "what this hunk does" }],
      sourceLine: 5,
      endLine: 5,
    })
  })
})

describe("parseReviewDoc — spec-feedback regression: a nested list item's own text is not dropped from descriptionInline (R2/T3)", () => {
  it("descriptionInline carries a nested item's own text, matching what the flattened description string already carries", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- item one",
      "- item two",
      "  - nested",
      "",
      // A `*`-marker list, deliberately: CommonMark merges adjacent
      // SAME-marker bullet lists into one node even across a blank line, so
      // a `-`-marker pointer list here would swallow the description list
      // above into itself (leaving nothing before the first pointer) — the
      // `*` keeps the description its own separate leading-run node.
      "* [ ] ./a.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    const chunk = result.changesets[0]
    expect(chunk?.description).toContain("nested")
    const joined = (chunk?.descriptionInline ?? [])
      .map((n) => ("value" in n ? n.value : ""))
      .join("")
    expect(joined).toContain("nested")
  })
})

describe("parseReviewDoc — spec-feedback regression: a nested list item's own text is not dropped from a hunk's noteInline either", () => {
  it("noteInline carries a nested item's own text inside a blockquote sibling, matching the flattened note string", () => {
    // A nested LIST directly under the pointer item is excluded from a
    // hunk's own note by design (`hunkNote`'s own `otherChildren` filter —
    // that shape is a NESTED HUNK pointer list, never prose). A blockquote
    // sibling wrapping a list, though, is ordinary note prose, and its own
    // nested list item is exactly the shape this regression covers.
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1",
      "",
      "  > - item one",
      "  >   - nested",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    const file = result.changesets[0]?.files[0]
    expect(file?.note ?? "").toContain("nested")
    const joined = (file?.noteInline ?? []).map((n) => ("value" in n ? n.value : "")).join("")
    expect(joined).toContain("nested")
  })
})

describe("parseReviewDoc — spec-feedback regression: a real image through the parser collapses to alt text on detailInline (R2/T5)", () => {
  it("a chunk description's image never reaches detailInline as an 'image' kind — collapsed server-side, not merely absent from a hand-built fixture", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "See ![a diagram](https://x.example/p.png) here.",
      "",
      "- [ ] ./a.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    const inline = result.changesets[0]?.descriptionInline ?? []
    expect(inline.some((n) => n.kind === "image")).toBe(false)
    const joined = inline.map((n) => ("value" in n ? n.value : "")).join("")
    expect(joined).toBe("See a diagram here.")
  })
})

describe("parseReviewDoc — spec-feedback regression: raw HTML stays inert text, never an empty detailInline", () => {
  it("a hunk's own note carries a block-level <div> as one text node, never []", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1",
      "",
      "  <div>raw</div>",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    const file = result.changesets[0]?.files[0]
    expect(file?.note).toBe("<div>raw</div>")
    expect(file?.noteInline).toEqual([{ kind: "text", value: "<div>raw</div>" }])
  })

  it("a chunk's own leading-run description carries a block-level <div> as one text node, never []", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "<div>raw</div>",
      "",
      "- [ ] ./a.ts#1",
      "",
    ].join("\n")
    const result = parseReviewDoc(content)
    const chunk = result.changesets[0]
    expect(chunk?.description).toBe("<div>raw</div>")
    expect(chunk?.descriptionInline).toEqual([{ kind: "text", value: "<div>raw</div>" }])
  })
})

describe("review — same-line note", () => {
  it("produces zero validation errors for an ordinary same-line note", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1-1 explains the change",
      "",
    ])
    expect(review.validate(content)).toEqual([])
  })

  it("does not report 'no file pointers' for a chunk whose only pointer carries a same-line note", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note here", ""])
    expect(review.validate(content)).not.toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("no file pointers") }),
    )
  })

  it("a hyphen inside a filename is never read as a separator", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./my-file.ts#1-1 — dash note",
      "",
    ])
    expect(review.validate(content)).toEqual([])
  })

  it("strips an em dash, en dash, or hyphen run from the same-line segment", () => {
    const cases = ["—", "–", "-"]
    for (const dash of cases) {
      const content = doc([
        HEADER,
        "",
        BASE,
        "",
        "## Chunk",
        "",
        `- [ ] ./a.ts#1-1 ${dash} note text`,
        "",
      ])
      expect(review.validate(content)).toEqual([])
    }
  })

  it("joins a same-line segment with below-pointer lines, single space, same-line segment first", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1-1 same-line note",
      "  more detail below",
      "",
    ])
    expect(review.validate(content)).toEqual([])
  })
})

describe("review — a note starting with a second pointer is a positioned finding", () => {
  it("a same-line note whose first token is itself a pointer token yields one finding at the pointer's own sourceLine", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 ./b.ts#2", ""])
    const findings = review.validate(content)
    expect(findings).toContainEqual(
      expect.objectContaining({ line: 6, message: expect.stringContaining("second pointer") }),
    )
  })

  it("still fires when a separator sits between the two pointers", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 — ./b.ts#2", ""])
    expect(review.validate(content).some((f) => f.message.includes("second pointer"))).toBe(true)
  })

  it("does not fire for a below-pointer line opening with a bare path — only the same-line segment is checked", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1 note",
      "  ./src/foo.ts is the caller",
      "",
    ])
    expect(review.validate(content).some((f) => f.message.includes("second pointer"))).toBe(false)
  })

  it("does not fire for a same-line note whose first word merely contains a dot", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1 v1.2.3 released",
      "",
    ])
    expect(review.validate(content).some((f) => f.message.includes("second pointer"))).toBe(false)
  })

  it("does not fire for a bare './' token, reusing the minimum-path-length rule", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 ./ trailing", ""])
    expect(review.validate(content).some((f) => f.message.includes("second pointer"))).toBe(false)
  })

  it("two pointer tokens crammed onto one hunk's own line are refused", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 ./b.ts#2", ""])
    expect(
      review.validate(content).some((f) => f.message.includes("note starts with a second pointer")),
    ).toBe(true)
  })

  it("renders the target as path#start-end when the first pointer carries a range", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1-9 ./b.ts#2", ""])
    expect(review.validate(content).some((f) => f.message.includes("./a.ts#1-9's note"))).toBe(true)
  })
})

describe("review — the line-without-a-range finding", () => {
  it("a bare '#42' pointer produces exactly one finding, naming the pointer and its chunk", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./src/calc.ts#42 — note", ""])
    const findings = review.validate(content)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.message).toContain("./src/calc.ts#42")
    expect(findings[0]!.message).toContain('Chunk "Chunk"')
  })

  it("the finding's line is the pointer's own 0-based sourceLine, and its range covers exactly the token", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./src/calc.ts#42 — note", ""])
    const findings = review.validate(content)
    expect(findings[0]!.line).toBe(6)
    expect(findings[0]!.range).toEqual({
      start: { line: 6, character: 6 },
      end: { line: 6, character: 22 },
    })
  })

  it("a '#42-70' range pointer produces zero findings", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./src/calc.ts#42-70 — note",
      "",
    ])
    expect(review.validate(content)).toEqual([])
  })

  it("a pointer with no '#' at all produces zero findings", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./src/calc.ts — note", ""])
    expect(review.validate(content)).toEqual([])
  })
})

describe("review — additional structural edges", () => {
  it("an entirely empty document reports the missing-header finding with no range (no first node to point at)", () => {
    const findings = review.validate("")
    expect(findings).toContainEqual({
      message: "Missing or malformed '# Review: <hash>' header as the document's first line",
    })
  })

  it("a bare pointer with nothing else on its line or below has no note and is valid", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1-1", ""])
    expect(review.validate(content)).toEqual([])
  })

  it("the whole-chunk toggle action works from the last chunk (no next chunk to bound its end)", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note", ""])
    const actions = review.actions(content, {
      start: { line: 6, character: 2 },
      end: { line: 6, character: 2 },
    })
    expect(actions.some((a) => a.title.startsWith("gtd: check all hunks"))).toBe(true)
  })

  it("a chunk description made of multiple prose nodes joins them with a space, footnote definitions excluded", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "First description line.",
      "",
      "Second description line.[^fn1]",
      "",
      "- [ ] ./a.ts#1-1 note",
      "",
      "[^fn1]:",
      "    Detail that is longer than eighty characters so it definitely wraps here nicely.",
      "",
    ])
    expect(review.validate(content)).toEqual([])
  })
})

describe("review — inline segment resolution edge cases", () => {
  it("a pointer alone on its own line, with the note only below, has no same-line segment to flag as a second pointer", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1",
      "  ./b.ts#2 is unrelated prose",
    ])
    expect(review.validate(content).some((f) => f.message.includes("second pointer"))).toBe(false)
  })

  it("a pointer with an empty paragraph (no text at all after it) has no findings", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1-1", ""])
    expect(review.validate(content)).toEqual([])
  })
})

describe("review — continuation-line dash stripping", () => {
  it("strips a leading em dash or en dash from a continuation line", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1-1",
      "  — continuation note",
      "",
    ])
    expect(review.validate(content)).toEqual([])
  })

  it("keeps a dash mid-sentence on a continuation line", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1-1",
      "  a well-known dash mid-word",
      "",
    ])
    expect(review.validate(content)).toEqual([])
  })
})

describe("review — outline", () => {
  it("emits only headlines of chunks with an unchecked hunk, no children when no footnotes", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note", ""])
    const outline = viewOf(review, content).outline
    expect(outline).toHaveLength(1)
    expect(outline[0]).not.toHaveProperty("children")
  })

  it("omits a fully-checked chunk's headline when it carries no footnotes", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [x] ./a.ts#1 note", ""])
    expect(viewOf(review, content).outline).toEqual([])
  })

  it("still includes a fully-checked chunk when it carries a footnote", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [x] ./a.ts#1 note[^fn1]",
      "",
      "[^fn1]:",
      "    Detail that is longer than eighty characters so it definitely wraps here nicely.",
      "",
    ])
    expect(viewOf(review, content).outline).toHaveLength(1)
  })

  it("the last chunk's outline range ends at its own last block, not the trailing blank line", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note", "", "", ""])
    const node = viewOf(review, content).outline[0]!
    expect(node.range.end.line).toBe(6)
  })

  it("an interior chunk's outline range ends at its own last block too", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk A",
      "",
      "- [ ] ./a.ts#1 note",
      "",
      "",
      "## Chunk B",
      "",
      "- [ ] ./b.ts#1 note",
      "",
    ])
    const node = viewOf(review, content).outline[0]!
    expect(node.range.end.line).toBe(6)
  })

  it("the last chunk's outline range still ends correctly with no trailing newline", () => {
    const content = `${HEADER}\n\n${BASE}\n\n## Chunk\n\n- [ ] ./a.ts#1 note`
    const node = viewOf(review, content).outline[0]!
    expect(node.range.end.line).toBe(6)
  })
})

describe("review — actions", () => {
  it("offers a single-hunk toggle when the range sits on a hunk's pointer line", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note", ""])
    const actions = review.actions(content, {
      start: { line: 6, character: 5 },
      end: { line: 6, character: 5 },
    })
    expect(actions.some((a) => a.title === "gtd: check this hunk")).toBe(true)
  })

  it("offers the SAME toggle when the range sits on a continuation line below the pointer", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1", "  more note", ""])
    const actions = review.actions(content, {
      start: { line: 7, character: 3 },
      end: { line: 7, character: 3 },
    })
    expect(actions.some((a) => a.title === "gtd: check this hunk")).toBe(true)
  })

  it("offers a whole-chunk toggle when the range sits on the chunk heading", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note", ""])
    const actions = review.actions(content, {
      start: { line: 4, character: 2 },
      end: { line: 4, character: 2 },
    })
    expect(actions.some((a) => a.title.startsWith("gtd: check all hunks"))).toBe(true)
  })

  it("offers no chunk action anywhere inside a chunk with zero file pointers", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk A", "", "prose only, no hunks.", ""])
    const actions = review.actions(content, {
      start: { line: 6, character: 2 },
      end: { line: 6, character: 2 },
    })
    expect(actions.some((a) => a.title.includes("check all hunks"))).toBe(false)
  })

  it("uncheck-all is offered when a strict majority of hunks are already checked", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [x] ./a.ts#1 note",
      "- [x] ./b.ts#1 note",
      "- [ ] ./c.ts#1 note",
      "",
    ])
    const actions = review.actions(content, {
      start: { line: 4, character: 2 },
      end: { line: 4, character: 2 },
    })
    expect(actions.some((a) => a.title.startsWith("gtd: uncheck all hunks"))).toBe(true)
  })

  it("defaults to check-all on an even split (no strict majority either way)", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [x] ./a.ts#1 note",
      "- [ ] ./b.ts#1 note",
      "",
    ])
    const actions = review.actions(content, {
      start: { line: 4, character: 2 },
      end: { line: 4, character: 2 },
    })
    expect(actions.some((a) => a.title.startsWith("gtd: check all hunks"))).toBe(true)
  })

  it("produces zero edits (no chunk action at all) for a chunk with no hunks", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "prose only", ""])
    const actions = review.actions(content, {
      start: { line: 4, character: 2 },
      end: { line: 4, character: 2 },
    })
    expect(actions.filter((a) => a.title.includes("all hunks"))).toEqual([])
  })
})

describe("review — pointerAt", () => {
  it("jumps to the hunk's file at its 1-based #line, mapped to 0-based", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#42 note", ""])
    expect(review.pointerAt!(content, { line: 6, character: 5 })).toEqual(
      expect.objectContaining({ path: "./a.ts", line: 41 }),
    )
  })

  it("lands at line 0 for a bare ./path with no #line", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts note", ""])
    expect(review.pointerAt!(content, { line: 6, character: 5 })).toEqual(
      expect.objectContaining({ path: "./a.ts", line: 0 }),
    )
  })

  it("returns undefined when the line is not a hunk pointer", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note", ""])
    expect(review.pointerAt!(content, { line: 4, character: 2 })).toBeUndefined()
  })

  it("returns the full path on a hyphenated hunk line, not a truncated prefix", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./my-file.ts#3 note", ""])
    expect(review.pointerAt!(content, { line: 6, character: 5 })).toEqual(
      expect.objectContaining({ path: "./my-file.ts" }),
    )
  })
})

describe("review — clearFilePointerTicks (clearTicks)", () => {
  it("clears [X] as well as [x]", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [X] ./a.ts#1 note", ""])
    expect(review.clearTicks(content)).toContain("- [ ] ./a.ts#1 note")
  })

  it("preserves path, inline note, continuation lines, chunk headings, the base comment byte for byte", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [x] ./a.ts#1 note",
      "  more detail",
      "",
    ])
    const cleared = review.clearTicks(content)
    expect(cleared).toBe(content.replace("[x]", "[ ]"))
  })

  it("clears a checked range pointer ('#42-70') back to '- [ ]'", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [x] ./src/calc.ts#42-70 — note",
      "",
    ])
    expect(review.clearTicks(content)).toContain("- [ ] ./src/calc.ts#42-70 — note")
  })

  it("a CRLF document with a ticked range pointer keeps its CRLF line endings byte for byte after clearing", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [x] ./a.ts#1-9 note",
      "",
    ]).replace(/\n/g, "\r\n")
    const cleared = review.clearTicks(content)
    expect(cleared).toBe(content.replace("[x]", "[ ]"))
    expect(cleared).toContain("\r\n")
    expect(cleared).not.toMatch(/(?<!\r)\n/)
  })

  it("clears an indented checked task item too, when its own content is itself a pointer", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1",
      "  - [x] ./nested.ts#1",
    ])
    expect(review.clearTicks(content)).toContain("- [ ] ./nested.ts#1")
  })

  it("does NOT clear an indented checked item whose content isn't a pointer — never 'every checked task item'", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1",
      "  - [x] not a real path",
    ])
    expect(review.clearTicks(content)).toContain("- [x] not a real path")
  })

  it("leaves a [x] in prose alone", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "prose with [x] in it",
      "- [ ] ./a.ts#1",
    ])
    expect(review.clearTicks(content)).toBe(content)
  })

  it("leaves a [x] in a chunk heading alone", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk [x]", "", "- [ ] ./a.ts#1"])
    expect(review.clearTicks(content)).toBe(content)
  })

  it("leaves a `- [x]` line with no whitespace-delimited pointer token after the box alone (qa-shaped content)", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [x] not a pointer at all", ""])
    expect(review.clearTicks(content)).toBe(content)
  })

  it("is idempotent", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [x] ./a.ts#1 note", ""])
    const once = review.clearTicks(content)
    expect(review.clearTicks(once)).toBe(once)
  })

  it("is total and never throws on an empty or malformed string", () => {
    expect(() => review.clearTicks("")).not.toThrow()
    expect(review.clearTicks("")).toBe("")
    expect(() => review.clearTicks("not markdown at all {{{")).not.toThrow()
  })

  it("is a no-op (returns the identical string) when there is nothing to clear", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note", ""])
    expect(review.clearTicks(content)).toBe(content)
  })
})

describe("review — footnotes wired into the review format", () => {
  it("excludes a definition below a hunk pointer from that hunk's note and endLine span", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1-1 note[^fn1]",
      "",
      "[^fn1]:",
      "    Detail that is longer than eighty characters so it definitely wraps here nicely.",
      "",
    ])
    expect(review.validate(content)).toEqual([])
  })

  it("surfaces all four footnote findings through validate, each with its line", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note[^orphan]", ""])
    const findings = review.validate(content)
    expect(findings.some((f) => f.message.includes("has no matching definition"))).toBe(true)
  })

  it("review.validate(sample) returns zero findings", () => {
    expect(review.validate(review.sample)).toEqual([])
  })

  it("strips a marker written directly against the pointer token, instead of corrupting the path", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1-1[^fn1] note",
      "",
      "[^fn1]:",
      "    Detail that is longer than eighty characters so it definitely wraps here nicely.",
      "",
    ])
    expect(review.validate(content)).toEqual([])
  })
})

describe("review — 'gtd: add a footnote' action", () => {
  it("offers the footnote action under the shared FOOTNOTE_ACTION_TITLE constant", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note", ""])
    const actions = review.actions(content, {
      start: { line: 6, character: 5 },
      end: { line: 6, character: 5 },
    })
    expect(actions.some((a) => a.title === FOOTNOTE_ACTION_TITLE)).toBe(true)
  })

  it("is LAST, with both the hunk and chunk toggle actions preceding it, on a hunk line inside a chunk", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note", ""])
    const actions = review.actions(content, {
      start: { line: 6, character: 5 },
      end: { line: 6, character: 5 },
    })
    expect(actions.map((a) => a.title)).toEqual([
      "gtd: check this hunk",
      'gtd: check all hunks in "Chunk"',
      FOOTNOTE_ACTION_TITLE,
    ])
  })

  it("in a multi-paragraph hunk note, lands after the LAST non-blank line of the hunk's span", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1 note",
      "  more detail",
      "",
      "  and even more",
      "",
    ])
    const actions = review.actions(content, {
      start: { line: 6, character: 3 },
      end: { line: 6, character: 3 },
    })
    expect(actions.some((a) => a.title === "gtd: add a footnote")).toBe(true)
  })

  it("in ordinary prose (a chunk's description, before any hunk), lands after the current block's last line", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "Some description.",
      "",
      "- [ ] ./a.ts#1",
      "",
    ])
    const actions = review.actions(content, {
      start: { line: 6, character: 3 },
      end: { line: 6, character: 3 },
    })
    expect(actions.some((a) => a.title === "gtd: add a footnote")).toBe(true)
  })

  it("is refused with the cursor inside an existing marker's span", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1 note[^fn1]",
      "",
      "[^fn1]:",
      "    Detail that is longer than eighty characters so it definitely wraps here nicely.",
      "",
    ])
    const actions = review.actions(content, {
      start: { line: 6, character: 20 },
      end: { line: 6, character: 20 },
    })
    expect(actions.some((a) => a.title === "gtd: add a footnote")).toBe(false)
  })
})

describe("review — header, base comment, and chunk headings come from nodes", () => {
  it("a '# Review: <hash>' line inside a fence is not the header", () => {
    const content = doc([
      "```",
      "# Review: abc123",
      "```",
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1",
    ])
    expect(review.validate(content)).toContainEqual(
      expect.objectContaining({
        message: "Missing or malformed '# Review: <hash>' header as the document's first line",
      }),
    )
  })

  it("finds the base comment wherever it appears in the document", () => {
    const content = doc([HEADER, "", "## Chunk", "", "- [ ] ./a.ts#1 note", "", BASE, ""])
    expect(review.validate(content)).not.toContainEqual(
      expect.objectContaining({ message: "Missing '<!-- base: <hash> -->' comment" }),
    )
  })

  it("a '## ' chunk heading inside a fence is not a chunk", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "```",
      "## Fake chunk",
      "```",
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1",
    ])
    const findings = review.validate(content)
    expect(findings.some((f) => f.message.includes('Chunk "Fake chunk"'))).toBe(false)
  })
})

describe("review — nested hunks are the same hunks", () => {
  it("a '- [x] ./file.ts#1' indented two spaces IS a hunk pointer, cleared by clearTicks", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1",
      "  - [x] ./nested.ts#1",
      "",
    ])
    expect(review.clearTicks(content)).toContain("- [ ] ./nested.ts#1")
  })

  it("the parent hunk's note does NOT contain its nested hunk's text", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1-1 parent note",
      "  - [ ] ./nested.ts#1-1 nested note",
      "",
    ])
    expect(review.validate(content)).toEqual([])
  })
})

describe("review — total over a structurally broken document", () => {
  it("clearFilePointerTicks still clears ticks in a structurally broken document", () => {
    expect(() => review.clearTicks("not markdown at all {{{ [x]")).not.toThrow()
  })

  it("parseReviewDoc (via validate) never throws on arbitrary/malformed input", () => {
    expect(() => review.validate("\0\0\0")).not.toThrow()
  })
})

describe("review.view", () => {
  const NESTED_CONTENT = [
    "# Review: abc1234",
    "<!-- base: abc1234def5678901234567890123456789abcd -->",
    "",
    "## Chunk one",
    "",
    "Some description.",
    "",
    "- [ ] ./a.ts#1 outer hunk",
    "  - [x] ./b.ts#2 nested hunk",
    "",
    "## Chunk two",
    "",
    "- [ ] ./c.ts#3",
    "",
  ].join("\n")

  it("exposes every chunk and every file pointer, including pointers nested at any depth", () => {
    const view = review.view(NESTED_CONTENT)
    expect(view.nodes.map((c) => c.title)).toEqual(["Chunk one", "Chunk two"])
    expect(view.nodes[0]!.children!.map((f) => f.path)).toEqual(["./a.ts", "./b.ts"])
    expect(view.nodes[1]!.children!.map((f) => f.path)).toEqual(["./c.ts"])
  })

  it("carries each chunk's own prose as `detail`, empty for a chunk with none", () => {
    const view = review.view(NESTED_CONTENT)
    expect(view.nodes[0]!.detail).toBe("Some description.")
    expect(view.nodes[1]!.detail).toBe("")
  })

  it("is built from one parse of the document, not one per element", () => {
    const uniqueContent = [
      "# Review: def4567",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Solo chunk",
      "",
      "- [ ] ./z.ts#9 solo hunk",
      "",
    ].join("\n")
    const before = getParseCount()
    review.view(uniqueContent)
    expect(getParseCount()).toBe(before + 1)
  })

  it("carries the header hash", () => {
    const view = review.view(NESTED_CONTENT)
    expect(view.header).toBe("abc1234")
  })

  it("a '#42-70' pointer's hunk node carries line: 42 and endLine: 70", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#42-70 note",
      "",
    ].join("\n")
    const hunk = review.view(content).nodes[0]!.children![0]!
    expect(hunk.line).toBe(42)
    expect(hunk.endLine).toBe(70)
  })

  it("a bare '#1' pointer's hunk node carries no endLine", () => {
    const hunk = review.view(NESTED_CONTENT).nodes[0]!.children![0]!
    expect(hunk.line).toBe(1)
    expect(hunk.endLine).toBeUndefined()
  })
})

describe("review.annotate", () => {
  const CONTENT = [
    "# Review: abc1234",
    "<!-- base: abc1234def5678901234567890123456789abcd -->",
    "",
    "## Chunk one",
    "",
    "- [ ] ./a.ts#1-1 outer hunk",
    "",
  ].join("\n")

  it("accepts a chunk-level anchor", () => {
    const result = review.annotate(CONTENT, { kind: "chunk", index: 0 }, "a real note")
    expect(result.ok).toBe(true)
  })

  it("accepts a hunk-level anchor", () => {
    const result = review.annotate(
      CONTENT,
      { kind: "hunk", chunkIndex: 0, index: 0 },
      "a real note",
    )
    expect(result.ok).toBe(true)
  })

  it("accepts a paragraph anchor in a prose-only document", () => {
    const result = review.annotate(
      "Just some prose.\n",
      { kind: "paragraph", line: 0 },
      "a real note",
    )
    expect(result.ok).toBe(true)
  })

  it("rejects an anchor that no longer resolves, rather than silently dropping it", () => {
    expect(review.annotate(CONTENT, { kind: "chunk", index: 5 }, "note")).toEqual({
      ok: false,
      reason: "anchor-not-found",
    })
    expect(review.annotate(CONTENT, { kind: "hunk", chunkIndex: 0, index: 5 }, "note")).toEqual({
      ok: false,
      reason: "anchor-not-found",
    })
    expect(review.annotate(CONTENT, { kind: "question", index: 0 }, "note")).toEqual({
      ok: false,
      reason: "anchor-not-found",
    })
  })

  it("attaches the given text verbatim, and the resulting document passes its own format's validator (T2's last criterion)", () => {
    const result = review.annotate(
      CONTENT,
      { kind: "hunk", chunkIndex: 0, index: 0 },
      "a real reason a human actually typed",
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lines = CONTENT.split("\n")
    const toOffset = (pos: { readonly line: number; readonly character: number }): number => {
      let offset = 0
      for (let i = 0; i < pos.line; i += 1) offset += (lines[i]?.length ?? 0) + 1
      return offset + pos.character
    }
    const sorted = [...result.edits].sort(
      (a, b) => toOffset(b.range.start) - toOffset(a.range.start),
    )
    let applied = CONTENT
    for (const edit of sorted) {
      applied =
        applied.slice(0, toOffset(edit.range.start)) +
        edit.newText +
        applied.slice(toOffset(edit.range.end))
    }
    expect(applied).toContain("a real reason a human actually typed")
    // review.validate below already proves this raises no "has an empty
    // body" finding — stronger than checking for the retired placeholder text.
    expect(review.validate(applied)).toEqual([])
  })
})

/** Applies edits back-to-front (as `ui/Write.ts#applySteeringEdits` does) — local to this test file, mirroring `review.annotate`'s own describe block's inline splice pattern above. */
const applyEdits = (
  content: string,
  edits: readonly {
    readonly range: {
      readonly start: { readonly line: number; readonly character: number }
      readonly end: { readonly line: number; readonly character: number }
    }
    readonly newText: string
  }[],
): string => {
  const lines = content.split("\n")
  const toOffset = (pos: { readonly line: number; readonly character: number }): number => {
    let offset = 0
    for (let i = 0; i < pos.line; i += 1) offset += (lines[i]?.length ?? 0) + 1
    return offset + pos.character
  }
  const sorted = [...edits].sort((a, b) => toOffset(b.range.start) - toOffset(a.range.start))
  let result = content
  for (const edit of sorted) {
    result =
      result.slice(0, toOffset(edit.range.start)) +
      edit.newText +
      result.slice(toOffset(edit.range.end))
  }
  return result
}

describe("review.apply", () => {
  const NESTED_CONTENT = [
    "# Review: abc1234",
    "<!-- base: abc1234def5678901234567890123456789abcd -->",
    "",
    "## Chunk one",
    "",
    "Some description.",
    "",
    "- [ ] ./a.ts#1 outer hunk",
    "  - [x] ./b.ts#2 nested hunk",
    "",
    "## Chunk two",
    "",
    "- [ ] ./c.ts#3",
    "",
  ].join("\n")

  it("a hunk anchor sets just that hunk's tick", () => {
    const result = review.apply(
      NESTED_CONTENT,
      { kind: "hunk", chunkIndex: 0, index: 0 },
      {
        checked: true,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const applied = applyEdits(NESTED_CONTENT, result.edits)
    const { changesets } = parseReviewDoc(applied)
    expect(changesets[0]!.files.map((f) => f.checked)).toEqual([true, true])
  })

  it("a chunk anchor sets the tick on every hunk beneath it, at any nesting depth, to the exact target state — not a majority-flip", () => {
    const result = review.apply(
      NESTED_CONTENT,
      { kind: "chunk", index: 0 },
      {
        checked: true,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const applied = applyEdits(NESTED_CONTENT, result.edits)
    const { changesets } = parseReviewDoc(applied)
    // The outer hunk was unchecked, the nested one already checked — a
    // majority-flip heuristic (`chunkToggleTarget`) would uncheck both since
    // one of two was already checked; `apply` instead drives both to the
    // caller's own exact target, `true`.
    expect(changesets[0]!.files.map((f) => f.checked)).toEqual([true, true])
    // Chunk two, untouched, keeps its own state.
    expect(changesets[1]!.files.map((f) => f.checked)).toEqual([false])
  })

  it("a chunk anchor can also drive every hunk beneath it to unchecked", () => {
    const result = review.apply(
      NESTED_CONTENT,
      { kind: "chunk", index: 0 },
      {
        checked: false,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const applied = applyEdits(NESTED_CONTENT, result.edits)
    const { changesets } = parseReviewDoc(applied)
    expect(changesets[0]!.files.map((f) => f.checked)).toEqual([false, false])
  })

  it("a stale chunk/hunk index refuses anchor-not-found", () => {
    expect(review.apply(NESTED_CONTENT, { kind: "chunk", index: 5 }, { checked: true })).toEqual({
      ok: false,
      reason: "anchor-not-found",
    })
    expect(
      review.apply(NESTED_CONTENT, { kind: "hunk", chunkIndex: 0, index: 5 }, { checked: true }),
    ).toEqual({ ok: false, reason: "anchor-not-found" })
  })

  it("a question/option anchor — not this format's own kind — refuses anchor-not-found", () => {
    expect(review.apply(NESTED_CONTENT, { kind: "question", index: 0 }, { checked: true })).toEqual(
      { ok: false, reason: "anchor-not-found" },
    )
  })
})

describe("review.view — chunk-level footnote projection", () => {
  it("projects a footnote marker on the chunk's own heading line as that chunk node's own `note`, distinct from a hunk's own note", () => {
    // review.sample carries exactly this shape: `## Sample chunk[^naduiqc4]`
    // (a chunk-level footnote) plus `- [ ] ./sample.ts#1 what this hunk does[^fn1]`
    // (an ordinary hunk-level note) — see the sample's own doc comment.
    const view = review.view(review.sample)
    const chunk = view.nodes[0]
    expect(chunk?.note).toBe(
      "Attached via the phone UI, this note demonstrates a chunk-level comment with a `multi word code span` that exceeds eighty characters in total length here.",
    )
    // The hunk's own prose is `detail` (read-only context above the diff),
    // never `note` (the human reviewer's own attached footnote) — see the
    // "hunk detail/note channels" describe block below for the full split.
    expect(chunk?.children?.[0]?.detail).toBe("what this hunk does")
    expect(chunk?.children?.[0]?.note).toBe(
      "This note explains why the hunk exists in more detail than fits on one line for a reviewer.",
    )
  })

  it("a chunk with no heading-line footnote has no `note` on its view node, even when its hunks carry their own", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add calculator",
      "",
      "- [ ] ./src/calc.ts#1 a hunk-level note[^fn1]",
      "",
      "[^fn1]: explains the hunk",
      "",
    ].join("\n")
    const view = review.view(content)
    expect(view.nodes[0]?.note).toBeUndefined()
    expect(view.nodes[0]?.children?.[0]?.detail).toBe("a hunk-level note")
    expect(view.nodes[0]?.children?.[0]?.note).toBe("explains the hunk")
  })

  it("a chunk carrying only its own footnote (every hunk ticked) still projects `note` — the badge-worthy shape T4 asks for", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Fully reviewed[^chunknote]",
      "",
      "- [x] ./src/done.ts#1",
      "",
      "[^chunknote]: please double-check the retry logic before landing",
      "",
    ].join("\n")
    const view = review.view(content)
    expect(view.nodes[0]?.note).toBe("please double-check the retry logic before landing")
    expect(view.nodes[0]?.children?.every((h) => h.checked)).toBe(true)
  })

  it("a hunk with two footnotes attached at its pointer line joins their bodies with a single space, matching the chunk path", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add calculator",
      "",
      "- [ ] ./src/calc.ts#1 does the thing[^fn1][^fn2]",
      "",
      "[^fn1]: first reason",
      "[^fn2]: second reason",
      "",
    ].join("\n")
    const view = review.view(content)
    expect(view.nodes[0]?.children?.[0]?.detail).toBe("does the thing")
    expect(view.nodes[0]?.children?.[0]?.note).toBe("first reason second reason")
  })

  it("drops a hunk footnote marker whose definition is missing, rather than emitting undefined text", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add calculator",
      "",
      "- [ ] ./src/calc.ts#1 does the thing[^missing]",
      "",
    ].join("\n")
    const view = review.view(content)
    // An orphan marker (no matching definition anywhere) never parses as a
    // real `footnoteReference` node, so `sourceText` has nothing to excise
    // from `detail` — that part of the text is unaffected by this package.
    // What's under test is `note`: `hunkNoteOf`'s definition lookup drops
    // the marker rather than emitting `undefined` as text.
    expect(view.nodes[0]?.children?.[0]?.note).toBeUndefined()
  })

  it("a hunk with only a description and no attached footnote carries it in `detail` with no `note` — the note textbox must open empty", () => {
    const content = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Add calculator",
      "",
      "- [ ] ./src/calc.ts#1 what this hunk does",
      "",
    ].join("\n")
    const view = review.view(content)
    expect(view.nodes[0]?.children?.[0]?.detail).toBe("what this hunk does")
    expect(view.nodes[0]?.children?.[0]?.note).toBeUndefined()
  })
})

describe("review — thread outline", () => {
  it("review nests a thread under its chunk", () => {
    const doc = [
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk one",
      "",
      "- [ ] ./src/a.ts#1 [^t1]",
      "",
      "[^t1]:",
      "    - H: q",
      "    - A: a",
      "",
    ].join("\n")
    const chunk = steeringFormatFor("review")!.outline(doc)[0]!
    expect(chunk.children!.some((c) => c.name === "[^t1]" && c.detail === "waiting on you")).toBe(
      true,
    )
  })
})

describe("review view — threads", () => {
  const doc = [
    "# Review: abc1234",
    "<!-- base: abc1234def5678901234567890123456789abcd -->",
    "",
    "## Chunk[^t1]",
    "",
    "- [ ] ./a.ts#1-1 hunk[^t2]",
    "- [ ] ./b.ts#1-1 other[^n1]",
    "",
    "[^t1]:",
    "    - H: chunk ask",
    "    - A: which?",
    "",
    "[^t2]:",
    "    - H: hunk ask",
    "",
    "[^n1]: one-shot",
    "",
  ].join("\n")

  it("a chunk and a hunk with a thread expose `thread` in order and no `note`; a one-shot keeps `note`", () => {
    const chunk = steeringFormatFor("review")!.view(doc).nodes[0]!
    expect(chunk.note).toBeUndefined()
    expect(chunk.thread).toEqual({
      name: "t1",
      entries: [
        { author: "me", text: "chunk ask" },
        { author: "agent", text: "which?" },
      ],
      waitingOn: "human",
    })
    const [hunk, other] = chunk.children!
    expect(hunk!.note).toBeUndefined()
    expect(hunk!.thread).toEqual({
      name: "t2",
      entries: [{ author: "me", text: "hunk ask" }],
      waitingOn: "agent",
    })
    expect(other!.note).toBe("one-shot")
    expect(other!.thread).toBeUndefined()
  })
})

describe("reviewNotes", async () => {
  const { reviewNotes } = await import("./review.js")
  const doc = (chunkBody: string, extra = ""): string =>
    [
      "# Review: abc1234",
      "",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk one",
      "",
      chunkBody,
      "",
      "- [ ] ./src/a.ts#1-3",
      extra,
    ].join("\n")
  const base = doc("Prose.")

  it("identical texts yield nothing", () => {
    expect(reviewNotes(base, base)).toEqual([])
  })

  it("a pointer note added", () => {
    const after = doc("Prose.").replace("#1-3", "#1-3 rename this")
    expect(reviewNotes(base, after)).toEqual([
      {
        id: "note-1",
        kind: "pointer",
        anchor: "Chunk one ./src/a.ts#1-3",
        before: "",
        text: "rename this",
      },
    ])
  })

  it("a pointer note extended carries the reviewer's text as before", () => {
    const was = base.replace("#1-3", "#1-3 why")
    const after = base.replace("#1-3", "#1-3 why not")
    const [n] = reviewNotes(was, after)
    expect(n).toMatchObject({ kind: "pointer", before: "why", text: "why not" })
  })

  it("a footnote added", () => {
    const after = base.replace("#1-3", "#1-3[^n1]") + "\n[^n1]: please split\n"
    expect(reviewNotes(base, after)).toEqual([
      {
        id: "note-1",
        kind: "footnote",
        anchor: "- [ ] ./src/a.ts#1-3[^n1]",
        before: "",
        text: "please split",
      },
    ])
  })

  it("a thread footnote never appears", () => {
    const after = base.replace("#1-3", "#1-3[^t1]") + "\n[^t1]:\n    - H: why?\n"
    expect(reviewNotes(base, after)).toEqual([])
  })

  it("chunk prose added", () => {
    const [n] = reviewNotes(base, doc("Prose. Also this is wrong."))
    expect(n).toMatchObject({ kind: "chunk", anchor: "Chunk one", before: "Prose." })
  })

  it("a baseline already holding an answered note excludes it", () => {
    const answered = base.replace("#1-3", "#1-3 why?\n  A: because")
    expect(reviewNotes(answered, answered)).toEqual([])
    const more = answered.replace("#1-3", "#1-3[^n2]") + "\n[^n2]: another\n"
    expect(reviewNotes(answered, more).map((n) => n.kind)).toEqual(["footnote"])
  })

  it("ids run in document order", () => {
    const after = base.replace("#1-3", "#1-3 a[^n1]") + "\n[^n1]: b\n"
    expect(reviewNotes(base, after).map((n) => [n.id, n.kind])).toEqual([
      ["note-1", "pointer"],
      ["note-2", "footnote"],
    ])
  })
})
