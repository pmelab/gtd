import { describe, expect, it } from "vitest"
import { applySteeringEdits, type SteeringAnchor } from "./index.js"
import { widgetFormat } from "./widget.js"

const lines = (...ls: string[]): string => `${ls.join("\n")}\n`

const doc = lines(
  "# Plan",
  "",
  "Context.",
  "",
  "## 🔘 Store?",
  "",
  "Redis is deployed.",
  "",
  "- [x] Redis",
  "- [ ] Memory",
  "- [ ] ✏️",
  "",
  "## ☑️ Which?",
  "",
  "- [ ] a",
  "- [ ] b",
  "",
  "## 🔍 Chunk",
  "",
  "- [ ] ./src/a.ts#3-5 — the limiter",
  "- [ ] ./src/b.ts#9",
  "",
  "## ❔ Ship?",
  "",
  "- [ ] Yes",
)

const applied = (anchor: SteeringAnchor, opts: { checked?: boolean; text?: string }): string => {
  const result = widgetFormat.apply(doc, anchor, opts)
  if (!result.ok) throw new Error(result.reason)
  return applySteeringEdits(doc, result.edits)
}

describe("widgetFormat.view", () => {
  it("shows static blocks and one node per widget, in file order", () => {
    const { nodes } = widgetFormat.view(doc)
    expect(nodes.map((n) => [n.title, n.status ?? n.block?.kind])).toEqual([
      ["Plan", "heading"],
      ["Context.", "paragraph"],
      ["Store?", "single-select"],
      ["Which?", "multi-select"],
      ["Chunk", "review-checklist"],
      ["Ship?", "boolean"],
    ])
  })

  it("gives a select its description, options and custom answer", () => {
    const select = widgetFormat.view(doc).nodes[2]!
    expect(select).toMatchObject({
      detail: "Redis is deployed.",
      answered: true,
      anchor: { kind: "question", index: 0 },
      children: [
        { title: "Redis", checked: true, anchor: { kind: "option", questionIndex: 0, index: 0 } },
        { title: "Memory", checked: false },
        {
          title: "",
          status: "custom",
          checked: false,
          anchor: { kind: "option", questionIndex: 0, index: 2 },
        },
      ],
    })
  })

  it("gives a review checklist its hunks with paths and ranges", () => {
    const chunk = widgetFormat.view(doc).nodes[4]!
    expect(chunk).toMatchObject({
      answered: false,
      children: [
        { title: "./src/a.ts#3-5 — the limiter", path: "src/a.ts", line: 3, endLine: 5 },
        { title: "./src/b.ts#9", path: "src/b.ts", line: 9 },
      ],
    })
  })
})

describe("widgetFormat.apply", () => {
  it("ticks a single select's option and unticks the others", () => {
    expect(applied({ kind: "option", questionIndex: 0, index: 1 }, { checked: true })).toContain(
      "- [ ] Redis\n- [x] Memory\n- [ ] ✏️\n",
    )
  })

  it("writes a custom answer, unticking the options", () => {
    expect(
      applied({ kind: "option", questionIndex: 0, index: 2 }, { checked: true, text: "Postgres" }),
    ).toContain("- [ ] Redis\n- [ ] Memory\n- [x] ✏️ Postgres\n")
  })

  it("toggles a multi select option alone", () => {
    expect(applied({ kind: "option", questionIndex: 1, index: 1 }, { checked: true })).toContain(
      "- [ ] a\n- [x] b\n",
    )
  })

  it("ticks one hunk, or every hunk of a checklist", () => {
    expect(applied({ kind: "hunk", chunkIndex: 2, index: 1 }, { checked: true })).toContain(
      "- [ ] ./src/a.ts#3-5 — the limiter\n- [x] ./src/b.ts#9\n",
    )
    expect(applied({ kind: "question", index: 2 }, { checked: true })).toContain(
      "- [x] ./src/a.ts#3-5 — the limiter\n- [x] ./src/b.ts#9\n",
    )
  })

  it("ticks a boolean", () => {
    expect(applied({ kind: "option", questionIndex: 3, index: 0 }, { checked: true })).toContain(
      "- [x] Yes\n",
    )
  })

  it("refuses an anchor that names nothing", () => {
    expect(widgetFormat.apply(doc, { kind: "option", questionIndex: 9, index: 0 }, {})).toEqual({
      ok: false,
      reason: "anchor-not-found",
    })
  })
})

describe("widgetFormat.annotate", () => {
  it("adds a marker on the anchored line and the note at the end", () => {
    const result = widgetFormat.annotate(doc, { kind: "paragraph", line: 2 }, "Why?")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const annotated = applySteeringEdits(doc, result.edits)
    expect(annotated).toContain("Context.[^fn1]\n")
    expect(annotated.endsWith("- [ ] Yes\n\n[^fn1]: Why?\n")).toBe(true)
    expect(widgetFormat.view(annotated).nodes[2]).toMatchObject({ answered: true })
  })

  it("puts a widget's note on the widget", () => {
    const result = widgetFormat.annotate(doc, { kind: "question", index: 1 }, "Neither.")
    if (!result.ok) throw new Error(result.reason)
    const annotated = applySteeringEdits(doc, result.edits)
    expect(annotated).toContain("## ☑️ Which?[^fn1]\n")
    expect(widgetFormat.view(annotated).nodes[3]).toMatchObject({ note: "Neither." })
  })
})

describe("widgetFormat for the editor", () => {
  it("offers to pick an option, tick a hunk, and annotate", () => {
    const titles = (line: number) =>
      widgetFormat
        .actions(doc, { start: { line, character: 0 }, end: { line, character: 0 } })
        .map((a) => a.title)
    expect(titles(9)).toEqual(["gtd: pick this option", "gtd: add an annotation"])
    expect(titles(8)).toEqual(["gtd: add an annotation"])
    expect(titles(10)).toEqual(["gtd: write a custom answer", "gtd: add an annotation"])
    expect(titles(17)).toEqual(["gtd: tick every hunk", "gtd: add an annotation"])
    expect(titles(19)).toEqual(["gtd: tick", "gtd: add an annotation"])
  })

  it("links each hunk pointer to its file", () => {
    expect(widgetFormat.documentLinks?.(doc)).toEqual([
      {
        range: { start: { line: 19, character: 6 }, end: { line: 19, character: 20 } },
        path: "src/a.ts",
        line: 2,
      },
      {
        range: { start: { line: 20, character: 6 }, end: { line: 20, character: 18 } },
        path: "src/b.ts",
        line: 8,
      },
    ])
  })

  it("outlines one symbol per widget", () => {
    expect(widgetFormat.outline(doc).map((n) => [n.name, n.children?.length])).toEqual([
      ["🔘 Store?", 3],
      ["☑️ Which?", 2],
      ["🔍 Chunk", 2],
      ["❔ Ship?", 1],
    ])
  })

  it("reports structural findings and unanswered required widgets", () => {
    expect(widgetFormat.validate(doc).map((f) => f.message)).toEqual([
      '"Chunk": tick every hunk (2 unticked), or add an annotation to send it back',
    ])
  })
})
