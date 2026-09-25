import { describe, expect, it } from "vitest"
import { blockNodesOf } from "./Blocks.js"
import { parseMarkdown } from "./Blocks.fixture.js"

describe("blockNodesOf — default walk, no skip predicates", () => {
  it("yields every top-level block, in document order, when called with no options", () => {
    const content = [
      "# Heading",
      "",
      "- Item one",
      "  - Nested item",
      "",
      "```",
      "line one",
      "line two",
      "```",
      "",
      "> A blockquote.",
      "",
      "Paragraph one.",
      "",
      "Paragraph two.",
      "",
    ].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree)
    expect(nodes.map((n) => n.block?.kind)).toEqual([
      "heading",
      "list",
      "code",
      "blockquote",
      "paragraph",
      "paragraph",
    ])
  })

  it("excludes a footnoteDefinition node unconditionally", () => {
    const content = ["Paragraph with a marker[^fn1].", "", "[^fn1]: The note body.", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree)
    expect(nodes.map((n) => n.block?.kind)).toEqual(["paragraph"])
  })

  it("carries a {kind:'paragraph', line} anchor for every node, at its own start line", () => {
    const content = ["# Heading", "", "Paragraph.", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree)
    expect(nodes.map((n) => n.anchor)).toEqual([
      { kind: "paragraph", line: 0 },
      { kind: "paragraph", line: 2 },
    ])
  })

  it("surfaces a footnote marker anchored at a block's own start line as that block's own note", () => {
    const content = ["# Heading[^fn1]", "", "[^fn1]: A note on the heading.", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree)
    expect(nodes[0]?.note).toBe("A note on the heading.")
  })

  it("strips the '> ' continuation marker from a soft-broken blockquote's title and block.text", () => {
    const content = ["> quoted line", "> more", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree)
    expect(nodes[0]?.title).not.toContain(">")
    expect(nodes[0]?.block).toMatchObject({ kind: "blockquote", text: "quoted line more" })
  })

  it("keeps a two-paragraph blockquote's title unchanged (blank '>' line between paragraphs)", () => {
    const content = ["> First line.", ">", "> Second para.", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree)
    expect(nodes[0]?.title).toBe("First line. Second para.")
  })

  it("keeps a literal '>' typed mid-prose inside a blockquote", () => {
    const content = ["> a > b", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree)
    expect(nodes[0]?.title).toBe("a > b")
  })

  it("keeps an inline link's [label](url) syntax intact across a multi-line blockquote", () => {
    const content = ["> see [label](url)", "> more text", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree)
    expect(nodes[0]?.title).toBe("see [label](url) more text")
  })

  it("keeps a line-leading '>' inside a list item's own fenced code block — the blockquote strip is scoped to blockquotes only", () => {
    const content = ["- item", "", "  ```", "  a", "  > b", "  ```", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree)
    expect(nodes[0]?.block).toMatchObject({ kind: "list", items: [{ text: "item ``` a > b ```" }] })
  })
})

describe("blockNodesOf — caller-supplied skip predicates", () => {
  it("skipNode excludes a top-level node the caller identifies by content", () => {
    const content = ["# Skip me", "", "Paragraph.", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree, {
      skipNode: (_content, node) => node.type === "heading",
    })
    expect(nodes.map((n) => n.block?.kind)).toEqual(["paragraph"])
  })

  it("skipLine excludes a top-level node by its own start line", () => {
    const content = ["# Heading", "", "Paragraph.", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree, { skipLine: (line) => line === 0 })
    expect(nodes.map((n) => n.block?.kind)).toEqual(["paragraph"])
  })
})

describe("blockNodesOf — block.text", () => {
  it("omits block.text entirely for heading/list/paragraph", () => {
    const content = ["# A heading", "", "Plain paragraph.", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree)
    expect(nodes.map((n) => n.block?.text)).toEqual([undefined, undefined])
  })

  it("omits block entirely for a thematicBreak — unchanged from qa/review's own behaviour", () => {
    const content = ["Above.", "", "---", "", "Below.", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree)
    expect(nodes.map((n) => n.block)).toEqual([
      { kind: "paragraph" },
      undefined,
      { kind: "paragraph" },
    ])
  })
})
