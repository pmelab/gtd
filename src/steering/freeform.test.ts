import { describe, expect, it } from "vitest"
import { freeFormFormat } from "./freeform.js"
import { builtInModeNames, steeringFormatFor } from "./index.js"

/** Applies edits back-to-front — a local copy of the file's own splice pattern, mirroring `qa.test.ts`/`review.test.ts`'s identical helper. */
const applyEdits = (
  content: string,
  edits: readonly { range: unknown; newText: string }[],
): string => {
  const lines = content.split(/\r?\n/)
  const toOffset = (position: { line: number; character: number }): number => {
    let offset = 0
    for (let i = 0; i < position.line; i += 1) offset += (lines[i]?.length ?? 0) + 1
    return offset + position.character
  }
  const sorted = [...edits].sort((a, b) => {
    const ra = a.range as { start: { line: number; character: number } }
    const rb = b.range as { start: { line: number; character: number } }
    return toOffset(rb.start) - toOffset(ra.start)
  })
  let result = content
  for (const edit of sorted) {
    const range = edit.range as {
      start: { line: number; character: number }
      end: { line: number; character: number }
    }
    const start = toOffset(range.start)
    const end = toOffset(range.end)
    result = result.slice(0, start) + edit.newText + result.slice(end)
  }
  return result
}

/**
 * Applies edits with the SAME offset convention `applySteeringEdits`
 * (`src/ui/Write.ts`) uses in production: lines split on a bare `"\n"`, so a
 * CRLF line keeps its `\r` as part of the line's own length. `applyEdits`
 * above (this file's pre-existing helper) instead splits on `/\r?\n/`, which
 * strips `\r` and undercounts offsets in a CRLF document — fine for the
 * LF-only fixtures every other test in this file uses, but it would silently
 * corrupt the byte-exact CRLF assertions below. Not a normalizing helper:
 * mismatched newText/range still round-trips to the WRONG bytes, exactly as
 * production would.
 */
const applyEditsExact = (
  content: string,
  edits: readonly { range: unknown; newText: string }[],
): string => {
  const lines = content.split("\n")
  const toOffset = (position: { line: number; character: number }): number => {
    let offset = 0
    for (let i = 0; i < position.line; i += 1) offset += (lines[i]?.length ?? 0) + 1
    return offset + position.character
  }
  const sorted = [...edits].sort((a, b) => {
    const ra = a.range as { start: { line: number; character: number } }
    const rb = b.range as { start: { line: number; character: number } }
    return toOffset(rb.start) - toOffset(ra.start)
  })
  let result = content
  for (const edit of sorted) {
    const range = edit.range as {
      start: { line: number; character: number }
      end: { line: number; character: number }
    }
    const start = toOffset(range.start)
    const end = toOffset(range.end)
    result = result.slice(0, start) + edit.newText + result.slice(end)
  }
  return result
}

describe("freeFormFormat — registry", () => {
  it("is not registered: steeringFormatFor('freeform') returns undefined", () => {
    expect(steeringFormatFor("freeform")).toBeUndefined()
  })

  it("is not among the built-in mode names", () => {
    expect(builtInModeNames()).not.toContain("freeform")
  })
})

describe("freeFormFormat.sample", () => {
  it("validates clean", () => {
    expect(freeFormFormat.validate(freeFormFormat.sample)).toEqual([])
  })
})

describe("freeFormFormat.validate/outline/actions", () => {
  it("validate always returns []", () => {
    expect(freeFormFormat.validate("# Anything\n\nGoes.\n")).toEqual([])
  })

  it("outline always returns []", () => {
    expect(freeFormFormat.outline("# Anything\n\nGoes.\n")).toEqual([])
  })

  it("actions always returns []", () => {
    expect(
      freeFormFormat.actions("Some prose.\n", {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      }),
    ).toEqual([])
  })

  it("has no pointerAt or documentLinks", () => {
    expect(freeFormFormat.pointerAt).toBeUndefined()
    expect(freeFormFormat.documentLinks).toBeUndefined()
  })
})

describe("freeFormFormat.view", () => {
  it("returns every top-level block, in document order, each with a {kind:'paragraph', line} anchor", () => {
    const content = ["# Heading", "", "- one", "- two", "", "Paragraph.", ""].join("\n")
    const view = freeFormFormat.view(content)
    expect(view.nodes.map((n) => n.anchor)).toEqual([
      { kind: "paragraph", line: 0 },
      { kind: "paragraph", line: 2 },
      { kind: "paragraph", line: 5 },
    ])
  })

  it("sets block.text to the block's own raw source bytes, verbatim, for every kind", () => {
    const content = [
      "# A heading",
      "",
      "- one",
      "- two",
      "",
      "```js",
      "code();",
      "```",
      "",
      "> Quoted.",
      "",
      "Plain paragraph.",
      "",
    ].join("\n")
    const view = freeFormFormat.view(content)
    expect(view.nodes.map((n) => n.block?.text)).toEqual([
      "# A heading",
      "- one\n- two",
      "```js\ncode();\n```",
      "> Quoted.",
      "Plain paragraph.",
    ])
  })
})

describe("freeFormFormat.apply — replacing a block", () => {
  it("replaces the whole source range of the top-level block starting at line with text", () => {
    const content = ["# Heading", "", "Paragraph one.", "", "Paragraph two.", ""].join("\n")
    const result = freeFormFormat.apply(
      content,
      { kind: "paragraph", line: 2 },
      { text: "Edited." },
    )
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEdits(content, result.edits) : ""
    expect(applied).toBe(["# Heading", "", "Edited.", "", "Paragraph two.", ""].join("\n"))
  })

  it("replaces a heading block", () => {
    const content = ["# Old heading", "", "Body.", ""].join("\n")
    const result = freeFormFormat.apply(content, { kind: "paragraph", line: 0 }, { text: "# New" })
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEdits(content, result.edits) : ""
    expect(applied).toBe(["# New", "", "Body.", ""].join("\n"))
  })
})

describe("freeFormFormat.apply — deleting a block", () => {
  it("text: '' deletes the block and its trailing blank line", () => {
    const content = ["# Heading", "", "Paragraph one.", "", "Paragraph two.", ""].join("\n")
    const result = freeFormFormat.apply(content, { kind: "paragraph", line: 2 }, { text: "" })
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEdits(content, result.edits) : ""
    expect(applied).toBe(["# Heading", "", "Paragraph two.", ""].join("\n"))
  })

  it("deleting the last block leaves no trailing blank run behind", () => {
    const content = ["Paragraph one.", "", "Paragraph two.", ""].join("\n")
    const result = freeFormFormat.apply(content, { kind: "paragraph", line: 2 }, { text: "" })
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEdits(content, result.edits) : ""
    expect(applied).toBe(["Paragraph one.", ""].join("\n"))
  })
})

describe("freeFormFormat.apply — appending", () => {
  it("a line at the document's last line appends text at the end, preceded by a blank line", () => {
    const content = ["Paragraph one.", ""].join("\n")
    const lastLine = content.split(/\r?\n/).length - 1
    const result = freeFormFormat.apply(
      content,
      { kind: "paragraph", line: lastLine },
      { text: "New content." },
    )
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEdits(content, result.edits) : ""
    expect(applied).toBe(["Paragraph one.", "", "New content.", ""].join("\n"))
  })

  it("a line well past the document's end also appends", () => {
    const content = ["Paragraph one.", ""].join("\n")
    const result = freeFormFormat.apply(
      content,
      { kind: "paragraph", line: 9999 },
      { text: "New content." },
    )
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEdits(content, result.edits) : ""
    expect(applied).toBe(["Paragraph one.", "", "New content.", ""].join("\n"))
  })

  it("appending to an empty document produces just the new text", () => {
    const result = freeFormFormat.apply("", { kind: "paragraph", line: 0 }, { text: "First line." })
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEdits("", result.edits) : ""
    expect(applied).toBe("First line.\n")
  })

  it("an empty append (opts.text omitted, an append row submitted with nothing typed) leaves the document unchanged, not a bare trailing blank line", () => {
    const content = ["Paragraph one.", ""].join("\n")
    const lastLine = content.split(/\r?\n/).length - 1
    const result = freeFormFormat.apply(content, { kind: "paragraph", line: lastLine }, {})
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEdits(content, result.edits) : ""
    expect(applied).toBe(["Paragraph one.", ""].join("\n"))
  })
})

describe("freeFormFormat.apply — no block at that line", () => {
  it("refuses anchor-not-found for a line resolving to no block, not past the end", () => {
    const content = ["Paragraph one.", "", "Paragraph two.", ""].join("\n")
    const result = freeFormFormat.apply(content, { kind: "paragraph", line: 1 }, { text: "x" })
    expect(result).toEqual({ ok: false, reason: "anchor-not-found" })
  })
})

describe("freeFormFormat.apply — wrong anchor kind", () => {
  it("refuses a non-paragraph anchor", () => {
    const content = "Paragraph.\n"
    const result = freeFormFormat.apply(content, { kind: "chunk", index: 0 }, { text: "x" })
    expect(result).toEqual({ ok: false, reason: "anchor-not-found" })
  })
})

describe("freeFormFormat.annotate", () => {
  it("delegates to Footnotes.ts#footnoteAttachEdits: attaches a marker and a definition", () => {
    const content = ["Paragraph one.", ""].join("\n")
    const result = freeFormFormat.annotate(content, { kind: "paragraph", line: 0 }, "A note.")
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEdits(content, result.edits) : ""
    expect(applied).toContain("Paragraph one.[^")
    expect(applied).toContain("A note.")
    expect(freeFormFormat.validate(applied)).toEqual([])
  })

  it("refuses a non-paragraph anchor", () => {
    const result = freeFormFormat.annotate("x\n", { kind: "hunk", chunkIndex: 0, index: 0 }, "note")
    expect(result).toEqual({ ok: false, reason: "anchor-not-found" })
  })

  it("refuses when the line isn't inside any real block", () => {
    const content = ["Paragraph one.", "", "Paragraph two.", ""].join("\n")
    const result = freeFormFormat.annotate(content, { kind: "paragraph", line: 1 }, "note")
    expect(result).toEqual({ ok: false, reason: "anchor-not-found" })
  })
})

describe("freeFormFormat.apply — CRLF documents preserve untouched bytes", () => {
  it("replacing one block leaves every other line's bytes byte-identical", () => {
    const content = ["# Heading", "", "Paragraph one.", "", "Paragraph two.", ""].join("\r\n")
    const result = freeFormFormat.apply(
      content,
      { kind: "paragraph", line: 2 },
      { text: "Edited." },
    )
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEditsExact(content, result.edits) : ""
    expect(applied).toBe(["# Heading", "", "Edited.", "", "Paragraph two.", ""].join("\r\n"))
  })

  it("deleting one block leaves every other line's bytes byte-identical", () => {
    const content = ["# Heading", "", "Paragraph one.", "", "Paragraph two.", ""].join("\r\n")
    const result = freeFormFormat.apply(content, { kind: "paragraph", line: 2 }, { text: "" })
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEditsExact(content, result.edits) : ""
    expect(applied).toBe(["# Heading", "", "Paragraph two.", ""].join("\r\n"))
  })

  it("appending to a CRLF document uses CRLF for the new bytes too", () => {
    const content = ["Paragraph one.", ""].join("\r\n")
    const lastLine = content.split(/\r?\n/).length - 1
    const result = freeFormFormat.apply(
      content,
      { kind: "paragraph", line: lastLine },
      { text: "New content." },
    )
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEditsExact(content, result.edits) : ""
    expect(applied).toBe(["Paragraph one.", "", "New content.", ""].join("\r\n"))
  })

  it("pasting LF text into a CRLF document introduces no mixed endings", () => {
    const content = ["# Heading", "", "Paragraph one.", ""].join("\r\n")
    const result = freeFormFormat.apply(
      content,
      { kind: "paragraph", line: 2 },
      { text: "Line one.\nLine two." },
    )
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEditsExact(content, result.edits) : ""
    expect(applied).toBe(["# Heading", "", "Line one.", "Line two.", ""].join("\r\n"))
    expect(applied).not.toContain("\n\n")
    expect(applied.replace(/\r\n/g, "")).not.toContain("\n")
  })

  it("an LF document's existing byte-for-byte behaviour is unchanged", () => {
    const content = ["# Heading", "", "Paragraph one.", "", "Paragraph two.", ""].join("\n")
    const result = freeFormFormat.apply(
      content,
      { kind: "paragraph", line: 2 },
      { text: "Edited." },
    )
    expect(result.ok).toBe(true)
    const applied = result.ok ? applyEditsExact(content, result.edits) : ""
    expect(applied).toBe(["# Heading", "", "Edited.", "", "Paragraph two.", ""].join("\n"))
  })
})
