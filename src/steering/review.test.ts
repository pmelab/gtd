import { describe, expect, it } from "vitest"
import { checkSteering, clearTicks, steeringFormatFor, viewOf } from "./index.js"
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
      findings: [],
    })
  })
})

const review = steeringFormatFor("review")!

const doc = (lines: readonly string[]): string => lines.join("\n")

const HEADER = "# Review: abc123"
const BASE = "<!-- base: 0000000000000000000000000000000000000000 -->"

describe("review — structure (checkSteering)", () => {
  it("parses a well-formed review with one chunk, no explanations, cleanly", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 does a thing", ""])
    expect(checkSteering(review, content)).toEqual([])
  })

  it("errors when the header is missing", () => {
    const content = doc([BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 does a thing", ""])
    expect(checkSteering(review, content)).toContainEqual(
      expect.objectContaining({
        message: "Missing or malformed '# Review: <hash>' header as the document's first line",
      }),
    )
  })

  it("errors when the base comment is missing", () => {
    const content = doc([HEADER, "", "## Chunk", "", "- [ ] ./a.ts#1 does a thing", ""])
    expect(checkSteering(review, content)).toContainEqual(
      expect.objectContaining({ message: "Missing '<!-- base: <hash> -->' comment" }),
    )
  })

  it("errors when there are no chunks at all", () => {
    const content = doc([HEADER, "", BASE, ""])
    expect(checkSteering(review, content)).toContainEqual(
      expect.objectContaining({ message: "REVIEW.md has no '##' chunks" }),
    )
  })

  it("collects all applicable errors at once for a fully malformed document", () => {
    const findings = checkSteering(review, "")
    expect(findings.length).toBeGreaterThanOrEqual(2)
  })

  it("keeps a hyphenated path whole and its #line, instead of splitting at the first hyphen", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./my-file.ts#42 note", ""])
    expect(checkSteering(review, content)).toEqual([])
  })

  it("keeps a # not followed by digits in the path, with no line parsed, and no findings", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./file#hash.ts note", ""])
    expect(checkSteering(review, content)).toEqual([])
  })

  it("still refuses a bare box, a non-./ path, and a ./ with nothing after it — no pointer, so chunk is empty", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] just prose here", ""])
    expect(checkSteering(review, content)).toContainEqual(
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
    expect(checkSteering(review, content)).toContainEqual(
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
    expect(checkSteering(review, content)).toContainEqual(
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

  it("yields an empty description when the pointers are indented four spaces (a code block, not a list)", () => {
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
    expect(result.changesets[0]?.description).toBe("")
  })

  it("yields an empty description for a `###` sub-heading before the pointers", () => {
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
    expect(result.changesets[0]?.description).toBe("")
  })

  it("yields an empty description for an HTML comment before the pointers", () => {
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
    expect(result.changesets[0]?.description).toBe("")
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
      "- [ ] ./a.ts#1 explains the change",
      "",
    ])
    expect(checkSteering(review, content)).toEqual([])
  })

  it("does not report 'no file pointers' for a chunk whose only pointer carries a same-line note", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note here", ""])
    expect(checkSteering(review, content)).not.toContainEqual(
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
      "- [ ] ./my-file.ts#1 — dash note",
      "",
    ])
    expect(checkSteering(review, content)).toEqual([])
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
        `- [ ] ./a.ts#1 ${dash} note text`,
        "",
      ])
      expect(checkSteering(review, content)).toEqual([])
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
      "- [ ] ./a.ts#1 same-line note",
      "  more detail below",
      "",
    ])
    expect(checkSteering(review, content)).toEqual([])
  })
})

describe("review — a note starting with a second pointer is a positioned finding", () => {
  it("a same-line note whose first token is itself a pointer token yields one finding at the pointer's own sourceLine", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 ./b.ts#2", ""])
    const findings = checkSteering(review, content)
    expect(findings).toContainEqual(
      expect.objectContaining({ line: 6, message: expect.stringContaining("second pointer") }),
    )
  })

  it("still fires when a separator sits between the two pointers", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 — ./b.ts#2", ""])
    expect(checkSteering(review, content).some((f) => f.message.includes("second pointer"))).toBe(
      true,
    )
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
    expect(checkSteering(review, content).some((f) => f.message.includes("second pointer"))).toBe(
      false,
    )
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
    expect(checkSteering(review, content).some((f) => f.message.includes("second pointer"))).toBe(
      false,
    )
  })

  it("does not fire for a bare './' token, reusing the minimum-path-length rule", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 ./ trailing", ""])
    expect(checkSteering(review, content).some((f) => f.message.includes("second pointer"))).toBe(
      false,
    )
  })

  it("two pointer tokens crammed onto one hunk's own line are refused", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 ./b.ts#2", ""])
    expect(
      checkSteering(review, content).some((f) =>
        f.message.includes("note starts with a second pointer"),
      ),
    ).toBe(true)
  })
})

describe("review — additional structural edges", () => {
  it("an entirely empty document reports the missing-header finding with no range (no first node to point at)", () => {
    const findings = checkSteering(review, "")
    expect(findings).toContainEqual({
      message: "Missing or malformed '# Review: <hash>' header as the document's first line",
    })
  })

  it("a bare pointer with nothing else on its line or below has no note and is valid", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1", ""])
    expect(checkSteering(review, content)).toEqual([])
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
      "- [ ] ./a.ts#1 note",
      "",
      "[^fn1]:",
      "    Detail that is longer than eighty characters so it definitely wraps here nicely.",
      "",
    ])
    expect(checkSteering(review, content)).toEqual([])
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
    expect(checkSteering(review, content).some((f) => f.message.includes("second pointer"))).toBe(
      false,
    )
  })

  it("a pointer with an empty paragraph (no text at all after it) has no findings", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1", ""])
    expect(checkSteering(review, content)).toEqual([])
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
      "- [ ] ./a.ts#1",
      "  — continuation note",
      "",
    ])
    expect(checkSteering(review, content)).toEqual([])
  })

  it("keeps a dash mid-sentence on a continuation line", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1",
      "  a well-known dash mid-word",
      "",
    ])
    expect(checkSteering(review, content)).toEqual([])
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
    expect(clearTicks(review, content)).toContain("- [ ] ./a.ts#1 note")
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
    const cleared = clearTicks(review, content)
    expect(cleared).toBe(content.replace("[x]", "[ ]"))
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
    expect(clearTicks(review, content)).toContain("- [ ] ./nested.ts#1")
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
    expect(clearTicks(review, content)).toContain("- [x] not a real path")
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
    expect(clearTicks(review, content)).toBe(content)
  })

  it("leaves a [x] in a chunk heading alone", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk [x]", "", "- [ ] ./a.ts#1"])
    expect(clearTicks(review, content)).toBe(content)
  })

  it("leaves a `- [x]` line with no whitespace-delimited pointer token after the box alone (qa-shaped content)", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [x] not a pointer at all", ""])
    expect(clearTicks(review, content)).toBe(content)
  })

  it("is idempotent", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [x] ./a.ts#1 note", ""])
    const once = clearTicks(review, content)
    expect(clearTicks(review, once)).toBe(once)
  })

  it("is total and never throws on an empty or malformed string", () => {
    expect(() => clearTicks(review, "")).not.toThrow()
    expect(clearTicks(review, "")).toBe("")
    expect(() => clearTicks(review, "not markdown at all {{{")).not.toThrow()
  })

  it("is a no-op (returns the identical string) when there is nothing to clear", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note", ""])
    expect(clearTicks(review, content)).toBe(content)
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
      "- [ ] ./a.ts#1 note[^fn1]",
      "",
      "[^fn1]:",
      "    Detail that is longer than eighty characters so it definitely wraps here nicely.",
      "",
    ])
    expect(checkSteering(review, content)).toEqual([])
  })

  it("surfaces all four footnote findings through validate, each with its line", () => {
    const content = doc([HEADER, "", BASE, "", "## Chunk", "", "- [ ] ./a.ts#1 note[^orphan]", ""])
    const findings = checkSteering(review, content)
    expect(findings.some((f) => f.message.includes("has no matching definition"))).toBe(true)
  })

  it("review.validate(sample) returns zero findings", () => {
    expect(checkSteering(review, review.sample)).toEqual([])
  })

  it("strips a marker written directly against the pointer token, instead of corrupting the path", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1[^fn1] note",
      "",
      "[^fn1]:",
      "    Detail that is longer than eighty characters so it definitely wraps here nicely.",
      "",
    ])
    expect(checkSteering(review, content)).toEqual([])
  })
})

describe("review — 'gtd: add a footnote' action", () => {
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
    expect(checkSteering(review, content)).toContainEqual(
      expect.objectContaining({
        message: "Missing or malformed '# Review: <hash>' header as the document's first line",
      }),
    )
  })

  it("finds the base comment wherever it appears in the document", () => {
    const content = doc([HEADER, "", "## Chunk", "", "- [ ] ./a.ts#1 note", "", BASE, ""])
    expect(checkSteering(review, content)).not.toContainEqual(
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
    const findings = checkSteering(review, content)
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
    expect(clearTicks(review, content)).toContain("- [ ] ./nested.ts#1")
  })

  it("the parent hunk's note does NOT contain its nested hunk's text", () => {
    const content = doc([
      HEADER,
      "",
      BASE,
      "",
      "## Chunk",
      "",
      "- [ ] ./a.ts#1 parent note",
      "  - [ ] ./nested.ts#1 nested note",
      "",
    ])
    expect(checkSteering(review, content)).toEqual([])
  })
})

describe("review — total over a structurally broken document", () => {
  it("clearFilePointerTicks still clears ticks in a structurally broken document", () => {
    expect(() => clearTicks(review, "not markdown at all {{{ [x]")).not.toThrow()
  })

  it("parseReviewDoc (via checkSteering) never throws on arbitrary/malformed input", () => {
    expect(() => checkSteering(review, "\0\0\0")).not.toThrow()
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
})

describe("review.annotate", () => {
  const CONTENT = [
    "# Review: abc1234",
    "<!-- base: abc1234def5678901234567890123456789abcd -->",
    "",
    "## Chunk one",
    "",
    "- [ ] ./a.ts#1 outer hunk",
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
    expect(applied).not.toContain("your comment")
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
