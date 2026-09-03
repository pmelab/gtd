import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  blockNodeAt,
  getParseCount,
  parseMarkdown,
  sourceText,
  taskItems,
  toLspPosition,
  toLspPositionFromOffset,
} from "./MarkdownTree.js"
import { QA_FORMAT } from "./OpenQuestions.js"
import type { List, ListItem, Paragraph } from "mdast"

describe("parseMarkdown", () => {
  it("calls both GFM extensions: a task checkbox parses to checked === true, not null", () => {
    const tree = parseMarkdown("- [x] a\n")
    const list = tree.children[0] as List
    const item = list.children[0] as ListItem
    expect(item.checked).toBe(true)
  })

  it("never throws and always returns a root, for arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (content) => {
        const tree = parseMarkdown(content)
        expect(tree.type).toBe("root")
      }),
    )
  })

  it("converts a node starting at source line 1 column 1 to LSP line 0 character 0", () => {
    const tree = parseMarkdown("hello\n")
    const paragraph = tree.children[0]!
    // Sanity: mdast itself is 1-based — if this ever isn't true, the real
    // assertion below (going through `toLspPosition`) would trivially pass
    // for the wrong reason.
    expect(paragraph.position!.start).toEqual({ line: 1, column: 1, offset: 0 })
    expect(toLspPosition(paragraph.position!.start)).toEqual({ line: 0, character: 0 })
  })

  describe("memo", () => {
    it("returns the identical tree object for two calls with the same string, advancing the counter once", () => {
      const content = `unique content ${Math.PI}`
      const before = getParseCount()
      const first = parseMarkdown(content)
      const second = parseMarkdown(content)
      expect(second).toBe(first)
      expect(getParseCount()).toBe(before + 1)
    })

    it("evicts the previous entry for a different string, advancing the counter again", () => {
      const a = `content a ${Math.PI}`
      const b = `content b ${Math.PI}`
      const treeA = parseMarkdown(a)
      const before = getParseCount()
      const treeB = parseMarkdown(b)
      expect(treeB).not.toBe(treeA)
      expect(getParseCount()).toBe(before + 1)
    })

    it("holds one entry, not two: re-parsing the evicted string reparses rather than serving a stale cache hit", () => {
      const a = `content c ${Math.PI}`
      const b = `content d ${Math.PI}`
      const firstA = parseMarkdown(a)
      parseMarkdown(b) // evicts `a`
      const before = getParseCount()
      const secondA = parseMarkdown(a)
      expect(getParseCount()).toBe(before + 1) // reparsed, not a cache hit
      expect(secondA).not.toBe(firstA) // a fresh tree object, not the old one
    })

    it("performs one parse for a 2000-line document, not one per line", () => {
      const content = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n")
      const before = getParseCount()
      parseMarkdown(content)
      expect(getParseCount()).toBe(before + 1)
    })

    it("performs exactly one parse across one qa validate() call — the structural pass and the footnote pass share it", () => {
      const content = [
        "Build a thing.",
        ...Array.from({ length: 1990 }, (_, i) => `Line ${i} of padding prose.`),
        "",
        "## Open Questions",
        "",
        "### Which backend?",
        "",
        "- [x] SQLite",
        "- [ ] Postgres",
        "",
      ].join("\n")
      const before = getParseCount()
      QA_FORMAT.validate(content)
      expect(getParseCount()).toBe(before + 1)
    })
  })
})

describe("toLspPositionFromOffset", () => {
  it("is line 0 character 0 for offset 0", () => {
    expect(toLspPositionFromOffset("abc\ndef", 0)).toEqual({ line: 0, character: 0 })
  })

  it("lands on the second line after a newline", () => {
    const content = "abc\ndef"
    expect(toLspPositionFromOffset(content, content.indexOf("def"))).toEqual({
      line: 1,
      character: 0,
    })
  })

  it("counts characters within a later line correctly", () => {
    const content = "abc\ndefgh"
    expect(toLspPositionFromOffset(content, content.indexOf("gh"))).toEqual({
      line: 1,
      character: 3,
    })
  })
})

describe("sourceText", () => {
  it("keeps inline code verbatim and drops only a real footnote reference", () => {
    const content = "A claim `a[^fn1]b` and a real [^fn2] ref.\n\n[^fn2]: def\n"
    const tree = parseMarkdown(content)
    const paragraph = tree.children[0] as Paragraph
    expect(sourceText(content, paragraph)).toBe("A claim `a[^fn1]b` and a real ref.")
  })

  it("collapses a multi-line paragraph's whitespace to single spaces", () => {
    const content = "one\ntwo\nthree\n"
    const tree = parseMarkdown(content)
    expect(sourceText(content, tree.children[0]!)).toBe("one two three")
  })

  it("keeps a link and emphasis verbatim, alongside a dropped footnote reference", () => {
    const content = "See [the docs](https://example.com) for *why*[^fn1].\n\n[^fn1]: def\n"
    const tree = parseMarkdown(content)
    const paragraph = tree.children[0] as Paragraph
    expect(sourceText(content, paragraph)).toBe("See [the docs](https://example.com) for *why*.")
  })
})

describe("blockNodeAt", () => {
  it("finds the top-level block containing a 0-based line", () => {
    const content = "# heading\n\nsome paragraph text\n"
    const tree = parseMarkdown(content)
    expect(blockNodeAt(tree, 0)?.type).toBe("heading")
    expect(blockNodeAt(tree, 2)?.type).toBe("paragraph")
  })

  it("is undefined past the end of the document", () => {
    const tree = parseMarkdown("one line\n")
    expect(blockNodeAt(tree, 50)).toBeUndefined()
  })
})

describe("taskItems", () => {
  it("returns both items for a nested two-space-indented task list item", () => {
    const content = "- [x] a\n  - [x] b\n"
    const tree = parseMarkdown(content)
    const items = taskItems(tree)
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.checked === true)).toBe(true)
  })

  it("excludes ordinary (non-task) list items", () => {
    const content = "- a\n- [x] b\n"
    const tree = parseMarkdown(content)
    expect(taskItems(tree)).toHaveLength(1)
  })
})
