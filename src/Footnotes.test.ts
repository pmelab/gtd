import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  footnoteAdditionEdits,
  footnoteMarkerColumn,
  footnotePointerAt,
  isOnExistingFootnote,
  nextFootnoteName,
  parseFootnotes,
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
    expect(markers).toEqual([{ name: "fn1", line: 0, character: 19, endCharacter: 25 }])
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

  it("does not treat a two-space indent as a continuation — GFM requires four spaces, unlike the old hand-rolled walker", () => {
    const content = ["text[^fn1]", "", "[^fn1]:", "  first", "  second"].join("\n")
    const { definitions } = parseFootnotes(content)
    expect(definitions).toEqual([{ name: "fn1", line: 2, endLine: 2, body: "" }])
  })

  it("ends a definition at a blank line", () => {
    const content = ["text[^fn1]", "", "[^fn1]:", "    first", "", "not part of it"].join("\n")
    const { definitions } = parseFootnotes(content)
    expect(definitions[0]!.endLine).toBe(3)
    expect(definitions[0]!.body).toBe("first")
  })

  it("keeps an unindented line as a LAZY continuation of the body paragraph, per real GFM paragraph continuation rules", () => {
    const content = ["text[^fn1]", "", "[^fn1]:", "    first", "not indented, not part of it"].join(
      "\n",
    )
    const { definitions } = parseFootnotes(content)
    expect(definitions[0]!.endLine).toBe(4)
    expect(definitions[0]!.body).toBe("first not indented, not part of it")
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

  it("still finds an orphan [^y] written inside another definition's body — GFM applies the same reference-vs-text rule everywhere, no special-cased skip for a body's own prose", () => {
    const content = ["text[^fn1]", "", "[^fn1]:", "    see also [^y] here"].join("\n")
    const { markers } = parseFootnotes(content)
    expect(markers.map((m) => m.name)).toEqual(["fn1", "y"])
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
      {
        message: 'Footnote marker "[^fn1]" has no matching definition',
        line: 0,
        range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } },
      },
    ])
  })

  it("reports a definition no marker references at the definition's line", () => {
    const content = "no markers here\n\n[^fn1]: orphan definition"
    const { findings } = parseFootnotes(content)
    expect(findings).toEqual([
      {
        message: 'Footnote definition "[^fn1]" has no marker referencing it',
        line: 2,
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 25 } },
      },
    ])
  })

  it("reports a duplicate definition name at the second definition's line", () => {
    const content = ["a[^fn1]", "", "[^fn1]: first", "[^fn1]: second"].join("\n")
    const { findings } = parseFootnotes(content)
    expect(findings).toContainEqual({
      message: 'Duplicate footnote definition "[^fn1]"',
      line: 3,
      range: { start: { line: 3, character: 0 }, end: { line: 3, character: 14 } },
    })
  })

  it("reports a definition whose body is still the seeded placeholder", () => {
    const content = ["a[^fn1]", "", "[^fn1]: your comment"].join("\n")
    const { findings } = parseFootnotes(content)
    expect(findings).toContainEqual({
      message: 'Footnote definition "[^fn1]" still has its seeded placeholder body',
      line: 2,
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 20 } },
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

  it("does not recognize a definition below a fence opened above the slice it's handed — the tree sees the whole document, so a fence opened earlier still hides it", () => {
    const content = ["```", "[^fn1]: not a real definition, still fenced", "```"].join("\n")
    const { definitions, markers } = parseFootnotes(content)
    expect(definitions).toEqual([])
    expect(markers).toEqual([])
  })

  it("produces no marker for [^x] inside a four-space indented code block", () => {
    const content = ["    [^x] indented code", "", "real [^y]", "", "[^y]: d"].join("\n")
    const { markers } = parseFootnotes(content)
    expect(markers.map((m) => m.name)).toEqual(["y"])
  })

  it("produces no marker for [^x] inside a ~~~ fence", () => {
    const content = ["~~~", "[^x]", "~~~", "", "real [^y]", "", "[^y]: d"].join("\n")
    const { markers } = parseFootnotes(content)
    expect(markers.map((m) => m.name)).toEqual(["y"])
  })

  it("produces no marker for [^x] inside a double-backtick span", () => {
    const content = "prose ``[^x]`` and [^y] real\n\n[^y]: d"
    const { markers } = parseFootnotes(content)
    expect(markers.map((m) => m.name)).toEqual(["y"])
  })

  it("does not recognize a [^name]: definition written inside an inline-code span", () => {
    const content = "no ref here\n\n`[^fn1]: not a def`"
    const { definitions } = parseFootnotes(content)
    expect(definitions).toEqual([])
  })

  it("carries all of a multi-paragraph definition's paragraphs in body", () => {
    const content = ["text[^fn1]", "", "[^fn1]: first paragraph", "", "    second paragraph"].join(
      "\n",
    )
    const { definitions } = parseFootnotes(content)
    expect(definitions).toEqual([
      { name: "fn1", line: 2, endLine: 4, body: "first paragraph second paragraph" },
    ])
  })

  describe("orphan markers", () => {
    it("reports 'has no matching definition' for a marker with no definition anywhere", () => {
      const content = "Some text[^fn1] here."
      const { findings, markers } = parseFootnotes(content)
      expect(markers).toEqual([{ name: "fn1", line: 0, character: 9, endCharacter: 15 }])
      expect(findings).toEqual([
        {
          message: 'Footnote marker "[^fn1]" has no matching definition',
          line: 0,
          range: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } },
        },
      ])
    })

    it("reports the TRUE column of an orphan marker preceded on the same line by an entity reference, not node.value's shorter length", () => {
      const content = "&amp;[^fn1] after"
      const { markers } = parseFootnotes(content)
      // Source column is after the literal "&amp;" (5 chars), not the decoded "&" (1 char).
      expect(markers).toEqual([{ name: "fn1", line: 0, character: 5, endCharacter: 11 }])
    })

    it("reports line two, not the text node's start line, for an orphan on the second line of a lazy list-item wrap", () => {
      const content = ["- some text", "  continues[^fn1] here"].join("\n")
      const { markers } = parseFootnotes(content)
      expect(markers).toEqual([{ name: "fn1", line: 1, character: 11, endCharacter: 17 }])
    })

    it("reports nothing for an orphan inside a fence, an indented code block, or an inline-code span", () => {
      const content = ["```", "[^a]", "```", "", "    [^b] indented", "", "prose `[^c]` span"].join(
        "\n",
      )
      const { markers } = parseFootnotes(content)
      expect(markers).toEqual([])
    })
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

  it("counts an orphan marker (written but never given a definition) so it's never reused", () => {
    // fn1 has no definition anywhere — it's an orphan, not a footnoteReference node.
    expect(nextFootnoteName("prose[^fn1] more")).toBe("fn2")
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

describe("footnoteAdditionEdits", () => {
  it("inserts the marker at the cursor's word-scanned column, and a placeholder definition anchored one line PAST blockEndLine, separated by blank lines", () => {
    const content = ["Option A here", "", "next paragraph"].join("\n")
    const edits = footnoteAdditionEdits(content, { line: 0, character: 7 }, 0)
    expect(edits).toHaveLength(2)
    expect(edits[0]).toEqual({
      range: { start: { line: 0, character: 8 }, end: { line: 0, character: 8 } },
      newText: "[^fn1]",
    })
    expect(edits[1]!.newText).toBe("\n[^fn1]: your comment\n\n")
    expect(edits[1]!.range.start).toEqual({ line: 1, character: 0 })
    expect(edits[1]!.range.end).toEqual({ line: 2, character: 0 })
  })

  it("at end of file, seeds the definition with a single trailing newline, no extra blank line after", () => {
    const content = "Option A here"
    const edits = footnoteAdditionEdits(content, { line: 0, character: 7 }, 0)
    expect(edits[1]!.newText).toBe("\n[^fn1]: your comment\n")
    expect(edits[1]!.range.start).toEqual({ line: 1, character: 0 })
    expect(edits[1]!.range.end).toEqual({ line: 1, character: 0 })
  })

  it("generates the next unused name, never colliding with an existing footnote", () => {
    const content = ["a[^fn1]", "", "[^fn1]: reason"].join("\n")
    const edits = footnoteAdditionEdits(content, { line: 0, character: 1 }, 0)
    expect(edits[0]!.newText).toBe("[^fn2]")
  })

  it("never shares a start position between the two edits, even when the cursor sits at the very end of blockEndLine itself — the collision that corrupted the marker (regression)", () => {
    const content = ["some trailing prose", "", "next paragraph"].join("\n")
    const cursorCharacter = "some trailing prose".length // end of blockEndLine's own line
    const edits = footnoteAdditionEdits(content, { line: 0, character: cursorCharacter }, 0)
    const [markerEdit, definitionEdit] = edits
    // Same line as the marker would be a collision; one line later never is.
    expect(definitionEdit!.range.start.line).toBeGreaterThan(markerEdit!.range.start.line)
    expect(
      definitionEdit!.range.start.line === markerEdit!.range.end.line &&
        definitionEdit!.range.start.character === markerEdit!.range.end.character,
    ).toBe(false)
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

  it("returns undefined — not 'resolved, no pointer' — for a two-space-indented line that LOOKS like a continuation but isn't one per real GFM (regression: a since-deleted line-based helper used to dead-end here on its own looser 'any indent continues' rule)", () => {
    const content = ["text[^fn1]", "", "[^fn1]:", "  the reason"].join("\n")
    // The tree's real GFM continuation span ends at line 2 (four spaces are
    // required; this is indented only two) — line 3 is NOT part of the
    // definition, so the caller must be free to fall through instead of
    // getting stuck on "handled, but no pointer".
    expect(footnotePointerAt(content, { line: 3, character: 2 })).toBeUndefined()
  })
})

describe("isOnExistingFootnote", () => {
  const doc = ["a[^fn1] b", "", "[^fn1]: the reason", ""].join("\n")

  it("is true inside an existing marker's [^name] span", () => {
    const character = doc.split("\n")[0]!.indexOf("[^fn1]") + 2 // inside the name
    expect(isOnExistingFootnote(doc, { line: 0, character })).toBe(true)
  })

  it("is true on a definition's own label line", () => {
    expect(isOnExistingFootnote(doc, { line: 2, character: 3 })).toBe(true)
  })

  it("is true on a definition's indented continuation line", () => {
    const content = ["a[^fn1]", "", "[^fn1]:", "    continued body"].join("\n")
    expect(isOnExistingFootnote(content, { line: 3, character: 4 })).toBe(true)
  })

  it("is false for ordinary text, even right next to a marker", () => {
    expect(isOnExistingFootnote(doc, { line: 0, character: 8 })).toBe(false) // "b"
  })

  it("is false for a document with no footnotes at all", () => {
    expect(isOnExistingFootnote("just prose", { line: 0, character: 0 })).toBe(false)
  })

  it("refuses inside an orphan marker's span too — planting a name there would still corrupt existing `[^` syntax", () => {
    const content = "orphan[^missing] text"
    const character = content.indexOf("[^missing]") + 2
    expect(isOnExistingFootnote(content, { line: 0, character })).toBe(true)
  })
})

describe("case-insensitive definition matching", () => {
  it("resolves [^FN1] against a [^fn1]: definition with zero findings", () => {
    const content = "claim[^FN1]\n\n[^fn1]: the reason\n"
    const { findings } = parseFootnotes(content)
    expect(findings).toEqual([])
  })

  it("jumps between a differently-cased marker and its definition in both directions", () => {
    const content = "claim[^FN1]\n\n[^fn1]: the reason\n"
    const markerChar = content.indexOf("[^FN1]") + 2
    expect(footnotePointerAt(content, { line: 0, character: markerChar })?.pointer).toEqual({
      line: 2,
    })
    expect(footnotePointerAt(content, { line: 2, character: 0 })?.pointer).toEqual({
      line: 0,
      character: content.indexOf("[^FN1]"),
    })
  })

  it("renders a finding's message with the author's own casing (label), not the normalized identifier", () => {
    const content = "no marker for this one\n\n[^FN1]: orphan definition"
    const { findings } = parseFootnotes(content)
    expect(findings).toContainEqual({
      message: 'Footnote definition "[^FN1]" has no marker referencing it',
      line: 2,
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 25 } },
    })
  })
})
