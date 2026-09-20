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

describe("blockNodesOf — fullText option", () => {
  it("sets block.text to the node's own raw source bytes, verbatim, for every kind when fullText is set", () => {
    const content = ["# A heading", "", "- one", "- two", "", "Plain paragraph.", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree, { fullText: true })
    expect(nodes.map((n) => n.block?.text)).toEqual([
      "# A heading",
      "- one\n- two",
      "Plain paragraph.",
    ])
  })

  it("omits block.text entirely for heading/list/paragraph when fullText is not set", () => {
    const content = ["# A heading", "", "Plain paragraph.", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree)
    expect(nodes.map((n) => n.block?.text)).toEqual([undefined, undefined])
  })

  it("still carries a block with the raw source bytes for a node kind this walk otherwise projects no structure for (a thematicBreak)", () => {
    const content = ["Above.", "", "---", "", "Below.", ""].join("\n")
    const tree = parseMarkdown(content)
    const nodes = blockNodesOf(content, tree, { fullText: true })
    expect(nodes.map((n) => n.block)).toEqual([
      { kind: "paragraph", text: "Above." },
      { kind: "paragraph", text: "---" },
      { kind: "paragraph", text: "Below." },
    ])
  })

  it("omits block entirely for a thematicBreak when fullText is not set — unchanged from qa/review's own behaviour", () => {
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
