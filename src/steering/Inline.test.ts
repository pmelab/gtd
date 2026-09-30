import { describe, expect, it } from "vitest"
import type { Paragraph } from "mdast"
import { parseMarkdown } from "./Inline.fixture.js"
import { collapseImages, definitionsOf, joinInlineRuns, projectInline } from "./Inline.js"

const paragraphOf = (content: string): Paragraph => {
  const tree = parseMarkdown(content)
  return tree.children[0] as Paragraph
}

describe("projectInline", () => {
  it("projects strong, emphasis, delete, code, link and image", () => {
    const paragraph = paragraphOf(
      "**bold** _em_ ~~gone~~ `code` [label](https://x.example/a) ![alt](https://x.example/b.png)\n",
    )
    expect(projectInline(paragraph.children)).toEqual([
      { kind: "strong", children: [{ kind: "text", value: "bold" }] },
      { kind: "text", value: " " },
      { kind: "emphasis", children: [{ kind: "text", value: "em" }] },
      { kind: "text", value: " " },
      { kind: "delete", children: [{ kind: "text", value: "gone" }] },
      { kind: "text", value: " " },
      { kind: "code", value: "code" },
      { kind: "text", value: " " },
      {
        kind: "link",
        href: "https://x.example/a",
        children: [{ kind: "text", value: "label" }],
      },
      { kind: "text", value: " " },
      { kind: "image", src: "https://x.example/b.png", alt: "alt" },
    ])
  })

  it("drops a footnote reference structurally", () => {
    const paragraph = paragraphOf("See it[^note].\n\n[^note]: body\n")
    const nodes = projectInline(paragraph.children)
    expect(nodes).toEqual([
      { kind: "text", value: "See it" },
      { kind: "text", value: "." },
    ])
  })

  it("projects a hard break as a single space", () => {
    const paragraph = paragraphOf("one\\\ntwo\n")
    expect(projectInline(paragraph.children)).toEqual([
      { kind: "text", value: "one" },
      { kind: "text", value: " " },
      { kind: "text", value: "two" },
    ])
  })

  it("pins 'markdown is never raw HTML': a real <script> tag projects as one text node holding the raw tag, and no inline kind can ever carry HTML", () => {
    const paragraph = paragraphOf("before <script>window.__xss = true</script> after\n")
    const nodes = projectInline(paragraph.children)
    expect(nodes.every((n) => n.kind === "text")).toBe(true)
    const joined = nodes.map((n) => ("value" in n ? n.value : "")).join("")
    expect(joined).toBe("before <script>window.__xss = true</script> after")
  })

  it("projects inline HTML as inert text, never a carrying kind", () => {
    const paragraph = paragraphOf("before <script>window.__xss = true</script> after\n")
    const nodes = projectInline(paragraph.children)
    expect(nodes.some((n) => n.kind !== "text")).toBe(false)
    const joined = nodes.map((n) => ("value" in n ? n.value : "")).join("")
    expect(joined).toContain("<script>window.__xss = true</script>")
  })

  it("rejects a javascript: link href, keeping the label's own styled children", () => {
    const paragraph = paragraphOf("[click](javascript:alert(1))\n")
    expect(projectInline(paragraph.children)).toEqual([{ kind: "text", value: "click" }])
  })

  it("rejects an entity-decoded javascript: link href too — mdast decodes link.url before this ever sees it", () => {
    const paragraph = paragraphOf("[click](&#106;avascript:alert(1))\n")
    const nodes = projectInline(paragraph.children)
    expect(nodes.some((n) => n.kind === "link")).toBe(false)
  })

  it("degrades a rejected image to a text node carrying its alt", () => {
    const paragraph = paragraphOf("![alt text](javascript:alert(1))\n")
    expect(projectInline(paragraph.children)).toEqual([{ kind: "text", value: "alt text" }])
  })

  it("allows a scheme-less (relative) href/src, and mailto:", () => {
    const paragraph = paragraphOf("[a](./src/x.ts#42) [b](mailto:x@example.com)\n")
    const nodes = projectInline(paragraph.children)
    expect(nodes.filter((n) => n.kind === "link")).toHaveLength(2)
  })

  // Spec feedback: the WHATWG URL parser strips every ASCII tab/CR/LF from
  // the WHOLE input before it ever looks for a scheme, so a `javascript:`
  // href broken up by one of those characters still executes on tap even
  // though the raw string doesn't match `SCHEME_RE` at all.
  it("rejects a javascript: href broken by an entity-decoded tab", () => {
    const paragraph = paragraphOf("[a](java&#9;script:alert(1))\n")
    expect(projectInline(paragraph.children).some((n) => n.kind === "link")).toBe(false)
  })

  it("rejects a javascript: href broken by a LEADING entity-decoded tab", () => {
    const paragraph = paragraphOf("[a](&#9;javascript:alert(1))\n")
    expect(projectInline(paragraph.children).some((n) => n.kind === "link")).toBe(false)
  })

  it("rejects a javascript: href broken by an entity-decoded newline", () => {
    const paragraph = paragraphOf("[a](java&NewLine;script:alert(1))\n")
    expect(projectInline(paragraph.children).some((n) => n.kind === "link")).toBe(false)
  })

  // Spec feedback: the WHATWG URL parser ALSO trims every leading (and
  // trailing) C0 control or space off the whole input before it looks for a
  // scheme — a second pass beyond the tab/CR/LF removal above. Missing it
  // leaves a `javascript:` reachable via a leading space, a leading C0
  // control other than tab/CR/LF, or an angle-bracket destination's own
  // literal leading spaces.
  it("rejects a javascript: href prefixed by an entity-decoded leading space", () => {
    const paragraph = paragraphOf("[click](&#32;javascript:alert&#40;1&#41;)\n")
    expect(projectInline(paragraph.children).some((n) => n.kind === "link")).toBe(false)
  })

  it("rejects a javascript: href prefixed by a literal C0 control (U+0001) inside an angle-bracket destination", () => {
    // `&#1;` itself decodes to U+FFFD (the replacement character) in this
    // parser, never surviving as literal U+0001 — a real C0 control reaches
    // `link.url` intact only through an angle-bracket destination, which
    // tolerates raw control bytes an entity reference here does not.
    const paragraph = paragraphOf(`[click](<${String.fromCharCode(1)}javascript:alert(1)>)\n`)
    expect(projectInline(paragraph.children).some((n) => n.kind === "link")).toBe(false)
  })

  it("rejects a javascript: href prefixed by an entity-decoded form feed (U+000C)", () => {
    const paragraph = paragraphOf("[click](&#12;javascript:alert&#40;1&#41;)\n")
    expect(projectInline(paragraph.children).some((n) => n.kind === "link")).toBe(false)
  })

  it("rejects a javascript: href prefixed by literal leading spaces inside an angle-bracket destination", () => {
    const paragraph = paragraphOf("[click](<  javascript:alert(1)>)\n")
    expect(projectInline(paragraph.children).some((n) => n.kind === "link")).toBe(false)
  })

  it("the same leading-space/C0 hole is closed on image src too — one allowlist, both attributes", () => {
    const paragraph = paragraphOf("![alt](&#32;javascript:alert&#40;1&#41;)\n")
    expect(projectInline(paragraph.children)).toEqual([{ kind: "text", value: "alt" }])
  })

  // Spec feedback: R1 scopes in links/images with no reference-style
  // exclusion, and a rejected/unresolved reference must degrade (keep its
  // own label/alt) exactly like a rejected inline link/image — never vanish.
  it("resolves a linkReference through its own definition, exactly like a bare link", () => {
    const content = "See [the docs][1] here.\n\n[1]: https://example.com\n"
    const paragraph = paragraphOf(content)
    const nodes = projectInline(paragraph.children, definitionsOf(content))
    expect(nodes).toContainEqual({
      kind: "link",
      href: "https://example.com",
      children: [{ kind: "text", value: "the docs" }],
    })
  })

  it("degrades an UNRESOLVED linkReference (a real node whose identifier the given definitions map doesn't carry) to its own label text, never dropping it", () => {
    const content = "See [the docs][1] here.\n\n[1]: https://example.com\n"
    const paragraph = paragraphOf(content)
    // No `definitions` argument at all — the default empty map, mirroring a
    // caller that forgot to thread `definitionsOf` through.
    const nodes = projectInline(paragraph.children)
    const joined = nodes.map((n) => ("value" in n ? n.value : "")).join("")
    expect(joined).toBe("See the docs here.")
  })

  it("resolves an imageReference through its own definition, exactly like a bare image", () => {
    const content = "An ![pic][2] there.\n\n[2]: https://example.com/p.png\n"
    const paragraph = paragraphOf(content)
    const nodes = projectInline(paragraph.children, definitionsOf(content))
    expect(nodes).toContainEqual({ kind: "image", src: "https://example.com/p.png", alt: "pic" })
  })

  it("degrades an UNRESOLVED imageReference (a real node whose identifier the given definitions map doesn't carry) to its own alt text, never dropping it", () => {
    const content = "An ![pic][2] there.\n\n[2]: https://example.com/p.png\n"
    const paragraph = paragraphOf(content)
    const nodes = projectInline(paragraph.children)
    const joined = nodes.map((n) => ("value" in n ? n.value : "")).join("")
    expect(joined).toBe("An pic there.")
  })

  it("rejects a linkReference resolving to a javascript: url, degrading to its own label", () => {
    const content = "See [click][x] here.\n\n[x]: javascript:alert(1)\n"
    const paragraph = paragraphOf(content)
    const nodes = projectInline(paragraph.children, definitionsOf(content))
    expect(nodes.some((n) => n.kind === "link")).toBe(false)
    expect(nodes.map((n) => ("value" in n ? n.value : "")).join("")).toBe("See click here.")
  })

  // Spec feedback: `stripMarkerText` (the string-flattening path's own
  // regex) strips EVERY `[^name]`-shaped run, defined or not — a dangling
  // marker with no matching definition never becomes a real
  // `footnoteReference` node, so it must be stripped here too, or it leaks
  // into `inline`/`detailInline` for the first time.
  it("strips a DANGLING [^name] marker (no matching definition) from plain text, matching stripMarkerText's outcome", () => {
    const paragraph = paragraphOf("Dangling marker[^n1] here.\n")
    expect(projectInline(paragraph.children)).toEqual([
      { kind: "text", value: "Dangling marker here." },
    ])
  })
})

describe("collapseImages", () => {
  it("replaces an image, at any depth, with a text node carrying its alt", () => {
    const nested = [
      { kind: "strong" as const, children: [{ kind: "image" as const, src: "x", alt: "pic" }] },
    ]
    expect(collapseImages(nested)).toEqual([
      { kind: "strong", children: [{ kind: "text", value: "pic" }] },
    ])
  })
})

describe("joinInlineRuns", () => {
  it("joins non-empty runs with a single space text separator, dropping empty runs", () => {
    const a = [{ kind: "text" as const, value: "a" }]
    const b: readonly (typeof a)[number][] = []
    const c = [{ kind: "text" as const, value: "c" }]
    expect(joinInlineRuns([a, b, c])).toEqual([
      { kind: "text", value: "a" },
      { kind: "text", value: " " },
      { kind: "text", value: "c" },
    ])
  })
})
