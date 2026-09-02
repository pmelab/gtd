import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  footnoteAdditionEdits,
  footnoteMarkerColumn,
  footnotePointerAt,
  isFootnoteDefinitionLine,
  nextFootnoteName,
  parseFootnotes,
  proseBlockEnd,
  stripFootnoteMarkers,
} from "./Footnotes.js"

describe("parseFootnotes", () => {
  it("is total on an empty string", () => {
    expect(() => parseFootnotes("")).not.toThrow()
    expect(parseFootnotes("")).toEqual({ markers: [], definitions: [], findings: [] })
  })

  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (content) => {
        expect(() => parseFootnotes(content)).not.toThrow()
      }),
    )
  })

  it("is total on a document of only backticks", () => {
    expect(() => parseFootnotes("```````````")).not.toThrow()
  })

  it("yields the exact 0-based column of a marker mid-sentence", () => {
    const content = "Some prose, a claim[^fn1], continues.\n\n[^fn1]: the reason\n"
    const { markers } = parseFootnotes(content)
    expect(markers).toEqual([{ name: "fn1", line: 0, character: 19 }])
  })

  it("parses a single-line definition with endLine === line and its body", () => {
    const content = "text[^fn1]\n\n[^fn1]: a short reason\n"
    const { definitions } = parseFootnotes(content)
    expect(definitions).toEqual([{ name: "fn1", line: 2, endLine: 2, body: "a short reason" }])
  })

  it("joins four-space-indented continuation lines and tracks endLine", () => {
    const content = ["text[^fn1]", "", "[^fn1]:", "    first line of body", "    second line"].join(
      "\n",
    )
    const { definitions } = parseFootnotes(content)
    expect(definitions).toEqual([
      { name: "fn1", line: 2, endLine: 4, body: "first line of body second line" },
    ])
  })

  it("accepts a two-space-indented continuation the same way", () => {
    const content = ["text[^fn1]", "", "[^fn1]:", "  first", "  second"].join("\n")
    const { definitions } = parseFootnotes(content)
    expect(definitions).toEqual([{ name: "fn1", line: 2, endLine: 4, body: "first second" }])
  })

  it("ends a definition at a blank line", () => {
    const content = ["text[^fn1]", "", "[^fn1]:", "    first", "", "not part of it"].join("\n")
    const { definitions } = parseFootnotes(content)
    expect(definitions[0]!.endLine).toBe(3)
    expect(definitions[0]!.body).toBe("first")
  })

  it("ends a definition at an unindented line", () => {
    const content = ["text[^fn1]", "", "[^fn1]:", "    first", "not indented, not part of it"].join(
      "\n",
    )
    const { definitions } = parseFootnotes(content)
    expect(definitions[0]!.endLine).toBe(3)
    expect(definitions[0]!.body).toBe("first")
  })

  it("produces no marker for [^x] inside a fenced code block", () => {
    const content = ["```", "[^x]", "```", "", "[^y] real marker[^y]"].join("\n")
    const { markers } = parseFootnotes(content)
    expect(markers.map((m) => m.name)).toEqual(["y", "y"])
  })

  it("produces no marker for [^x] inside an inline-code span", () => {
    const content = "prose `[^x]` and [^y] real one"
    const { markers } = parseFootnotes(content)
    expect(markers.map((m) => m.name)).toEqual(["y"])
  })

  it("produces no marker for [^y] written inside another definition's body", () => {
    const content = ["text[^fn1]", "", "[^fn1]:", "    see also [^y] here"].join("\n")
    const { markers } = parseFootnotes(content)
    expect(markers.map((m) => m.name)).toEqual(["fn1"])
  })

  it("produces no finding for two markers of the same name with one definition", () => {
    const content = ["a[^fn1] b[^fn1]", "", "[^fn1]: reason"].join("\n")
    const { findings } = parseFootnotes(content)
    expect(findings).toEqual([])
  })

  it("reports a marker with no definition at the marker's line", () => {
    const content = "orphan marker[^fn1] here"
    const { findings } = parseFootnotes(content)
    expect(findings).toEqual([
      { message: 'Footnote marker "[^fn1]" has no matching definition', line: 0 },
    ])
  })

  it("reports a definition no marker references at the definition's line", () => {
    const content = "no markers here\n\n[^fn1]: orphan definition"
    const { findings } = parseFootnotes(content)
    expect(findings).toEqual([
      { message: 'Footnote definition "[^fn1]" has no marker referencing it', line: 2 },
    ])
  })

  it("reports a duplicate definition name at the second definition's line", () => {
    const content = ["a[^fn1]", "", "[^fn1]: first", "[^fn1]: second"].join("\n")
    const { findings } = parseFootnotes(content)
    expect(findings).toContainEqual({ message: 'Duplicate footnote definition "[^fn1]"', line: 3 })
  })

  it("reports a definition whose body is still the seeded placeholder", () => {
    const content = ["a[^fn1]", "", "[^fn1]: your comment"].join("\n")
    const { findings } = parseFootnotes(content)
    expect(findings).toContainEqual({
      message: 'Footnote definition "[^fn1]" still has its seeded placeholder body',
      line: 2,
    })
  })

  it("reports no finding of any kind for placement — a far-away definition is valid", () => {
    const content = [
      "a[^fn1] paragraph one",
      "",
      "paragraph two, unrelated",
      "",
      "paragraph three",
      "",
      "[^fn1]: the definition, far below",
    ].join("\n")
    const { findings } = parseFootnotes(content)
    expect(findings).toEqual([])
  })
})

describe("stripFootnoteMarkers", () => {
  it("removes a marker from text", () => {
    expect(stripFootnoteMarkers("Option A[^fn1]")).toBe("Option A")
  })

  it("leaves text with no marker untouched", () => {
    expect(stripFootnoteMarkers("plain text")).toBe("plain text")
  })
})

describe("isFootnoteDefinitionLine", () => {
  it("is true for a definition's start line", () => {
    const lines = ["[^fn1]: reason"]
    expect(isFootnoteDefinitionLine(lines, 0)).toBe(true)
  })

  it("is true for an indented continuation line", () => {
    const lines = ["[^fn1]:", "    continued here"]
    expect(isFootnoteDefinitionLine(lines, 1)).toBe(true)
  })

  it("is false for a blank line", () => {
    const lines = ["[^fn1]:", "    continued", "", "not part of it"]
    expect(isFootnoteDefinitionLine(lines, 2)).toBe(false)
    expect(isFootnoteDefinitionLine(lines, 3)).toBe(false)
  })

  it("is false for an ordinary line", () => {
    expect(isFootnoteDefinitionLine(["just prose"], 0)).toBe(false)
  })

  it("is false past the end of the array", () => {
    expect(isFootnoteDefinitionLine(["one line"], 5)).toBe(false)
  })

  it("is false for a '[^x]:'-shaped line inside a fenced code block, agreeing with parseFootnotes's own fence skip", () => {
    const lines = ["```", "[^x]: not a real definition, it's code", "```"]
    expect(isFootnoteDefinitionLine(lines, 1)).toBe(false)
    // parseFootnotes must agree: no definition parsed for the fenced line.
    expect(parseFootnotes(lines.join("\n")).definitions).toEqual([])
  })

  it("is false for an indented continuation line that is itself inside a fence", () => {
    const lines = ["[^fn1]:", "```", "    still fenced, not a continuation", "```"]
    expect(isFootnoteDefinitionLine(lines, 2)).toBe(false)
  })
})

describe("nextFootnoteName", () => {
  it("is fn1 for a document with no footnotes at all", () => {
    expect(nextFootnoteName("just prose")).toBe("fn1")
  })

  it("skips names already used by a marker or a definition, whichever is higher", () => {
    expect(nextFootnoteName("a[^fn1] b[^fn3]\n\n[^fn2]: reason")).toBe("fn4")
  })

  it("is idempotent across two applications: fn1 then fn2, never a collision", () => {
    const first = nextFootnoteName("prose")
    expect(first).toBe("fn1")
    const withFirst = `prose[^${first}]\n\n[^${first}]: your comment\n`
    expect(nextFootnoteName(withFirst)).toBe("fn2")
  })
})

describe("footnoteMarkerColumn", () => {
  it("lands at the word's end when the cursor sits inside it", () => {
    expect(footnoteMarkerColumn("Option A here", 7)).toBe(8) // cursor inside "A"
    expect(footnoteMarkerColumn("hello world", 2)).toBe(5) // cursor inside "hello"
  })

  it("stays at the cursor when it already sits just past a word", () => {
    expect(footnoteMarkerColumn("hello world", 5)).toBe(5) // right after "hello", before the space
  })

  it("stays at the cursor when it sits on whitespace or punctuation", () => {
    expect(footnoteMarkerColumn("hello, world", 5)).toBe(5) // on the comma
    expect(footnoteMarkerColumn("hello world", 5)).toBe(5) // on the space
  })
})

describe("proseBlockEnd", () => {
  it("stops at the next blank line", () => {
    const lines = ["a", "b", "", "c"]
    expect(proseBlockEnd(lines, 0)).toBe(1)
  })

  it("runs to end of file when there is no blank line", () => {
    const lines = ["a", "b", "c"]
    expect(proseBlockEnd(lines, 0)).toBe(2)
  })
})

describe("footnoteAdditionEdits", () => {
  it("inserts the marker at the cursor's word-scanned column, and a placeholder definition after blockEndLine, separated by blank lines", () => {
    const content = ["Option A here", "", "next paragraph"].join("\n")
    const edits = footnoteAdditionEdits(content, { line: 0, character: 7 }, 0)
    expect(edits).toHaveLength(2)
    expect(edits[0]).toEqual({
      range: { start: { line: 0, character: 8 }, end: { line: 0, character: 8 } },
      newText: "[^fn1]",
    })
    expect(edits[1]!.newText).toBe("\n\n[^fn1]: your comment\n\n")
    expect(edits[1]!.range.start).toEqual({ line: 0, character: "Option A here".length })
    expect(edits[1]!.range.end).toEqual({ line: 2, character: 0 })
  })

  it("at end of file, seeds the definition with a single trailing newline, no extra blank line after", () => {
    const content = "Option A here"
    const edits = footnoteAdditionEdits(content, { line: 0, character: 7 }, 0)
    expect(edits[1]!.newText).toBe("\n\n[^fn1]: your comment\n")
    expect(edits[1]!.range.end).toEqual({ line: 0, character: content.length })
  })

  it("generates the next unused name, never colliding with an existing footnote", () => {
    const content = ["a[^fn1]", "", "[^fn1]: reason"].join("\n")
    const edits = footnoteAdditionEdits(content, { line: 0, character: 1 }, 0)
    expect(edits[0]!.newText).toBe("[^fn2]")
  })
})

describe("footnotePointerAt", () => {
  const doc = ["a[^fn1] b", "", "[^fn1]: the reason", ""].join("\n")

  it("jumps from within a marker's span to its definition's line", () => {
    const character = doc.split("\n")[0]!.indexOf("[^fn1]") + 2 // inside the name
    expect(footnotePointerAt(doc, { line: 0, character })?.pointer).toEqual({ line: 2 })
  })

  it("jumps from a definition line to its first marker's line AND exact column", () => {
    const markerCol = doc.split("\n")[0]!.indexOf("[^fn1]")
    expect(footnotePointerAt(doc, { line: 2, character: 0 })?.pointer).toEqual({
      line: 0,
      character: markerCol,
    })
  })

  it("resolves an orphan marker to 'handled, but no pointer' rather than falling through", () => {
    const orphan = "orphan[^missing]"
    const character = orphan.indexOf("[^missing]") + 2
    const result = footnotePointerAt(orphan, { line: 0, character })
    expect(result).toEqual({ pointer: undefined })
  })

  it("resolves an orphan definition to 'handled, but no pointer'", () => {
    const orphan = "[^missing]: nobody points here"
    expect(footnotePointerAt(orphan, { line: 0, character: 0 })).toEqual({ pointer: undefined })
  })

  it("returns undefined (not applicable) for a position that is neither a marker nor a definition", () => {
    expect(footnotePointerAt(doc, { line: 0, character: 8 })).toBeUndefined() // "b", not the marker
  })
})
