import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parseWidgets } from "./Widgets.js"

const plan = readFileSync(new URL("./fixtures/widgets/plan.md", import.meta.url), "utf8")

const messages = (content: string): string[] =>
  parseWidgets(content).findings.map((f) => `${(f.line ?? -1) + 1}: ${f.message}`)

describe("parseWidgets", () => {
  it("reads every widget kind in file order", () => {
    const { widgets, findings } = parseWidgets(plan)
    expect(findings).toEqual([])
    expect(widgets.map((w) => [w.kind, w.title])).toEqual([
      ["static", "Plan: rate limiting"],
      ["single-select", "Where is the counter stored?"],
      ["multi-select", "Which endpoints?"],
      ["review-checklist", "Middleware"],
      ["boolean", "Ship behind a flag?"],
    ])
  })

  it("reads a select's description, options and custom answer", () => {
    const select = parseWidgets(plan).widgets[1]
    expect(select).toMatchObject({
      kind: "single-select",
      depth: 2,
      line: 4,
      description: "Redis is already deployed; memory is lost on restart.",
      options: [
        { label: "Redis", checked: false, line: 8 },
        { label: "In process memory", checked: false, line: 9 },
      ],
      custom: { text: "", checked: false, line: 10 },
    })
  })

  it("reads a widget under a lower-level heading", () => {
    expect(parseWidgets(plan).widgets[2]).toMatchObject({
      kind: "multi-select",
      depth: 3,
      options: [
        { label: "`/search`", checked: true },
        { label: "`/upload`", checked: false },
      ],
    })
    expect(parseWidgets(plan).widgets[2]).not.toHaveProperty("custom")
  })

  it("reads hunk pointers with their notes", () => {
    expect(parseWidgets(plan).widgets[3]).toMatchObject({
      hunks: [
        {
          pointer: "./src/middleware/limit.ts#1-40",
          path: "./src/middleware/limit.ts",
          start: 1,
          end: 40,
          note: "",
        },
        { pointer: "./src/app.ts#12-14", start: 12, end: 14, note: "wires it in" },
      ],
    })
  })

  it("reads a boolean", () => {
    expect(parseWidgets(plan).widgets[4]).toMatchObject({
      kind: "boolean",
      label: "Yes",
      checked: false,
    })
  })

  it("keeps content after a widget's list and unmarked headings as static", () => {
    const content =
      "## 🔘 Pick\n\n- [ ] a\n\nAfter the list.\n\n## Notes\n\nPlain.\n\n## 🚀 Launch\n\nMore.\n"
    expect(parseWidgets(content).widgets.map((w) => [w.kind, w.title])).toEqual([
      ["single-select", "Pick"],
      ["static", ""],
    ])
    expect(parseWidgets(content).widgets[1]).toMatchObject({
      markdown: "After the list.\n\n## Notes\n\nPlain.\n\n## 🚀 Launch\n\nMore.",
    })
  })

  it("keeps a plain list in the description and takes the first checkbox list as input", () => {
    const content = "## ☑️ Pick\n\nContext:\n\n- one\n- two\n\n- [ ] a\n- [x] b\n"
    const [widget] = parseWidgets(content).widgets
    expect(widget).toMatchObject({
      description: "Context:\n\n- one\n- two",
      options: [{ label: "a" }, { label: "b" }],
    })
  })

  it("accepts ☑ without the variation selector and a filled custom answer", () => {
    const [widget] = parseWidgets("## ☑ Pick\n\n- [ ] a\n- [ ] ✏️ something else\n").widgets
    expect(widget).toMatchObject({
      kind: "multi-select",
      custom: { text: "something else", checked: false },
    })
  })

  it("collects annotations and where their markers sit", () => {
    const content = "Intro.[^1]\n\n## 🔘 Pick\n\n- [ ] a[^2]\n\n[^1]: Why?\n[^2]: Not this.\n"
    const doc = parseWidgets(content)
    expect(doc.annotations).toEqual([
      { label: "1", text: "Why?", line: 6 },
      { label: "2", text: "Not this.", line: 7 },
    ])
    expect(doc.widgets.map((w) => w.annotations)).toEqual([["1"], ["2"]])
  })
})

describe("structural findings", () => {
  it("a widget heading with no checkbox list before the next heading", () => {
    expect(messages("## 🔘 Pick\n\n### Context\n\n- [ ] a\n")).toEqual([
      '1: "Pick": a 🔘 widget needs its checkbox list before the next heading',
    ])
  })

  it("a widget heading at the end of the file", () => {
    expect(messages("## ❔ Ready?\n")).toEqual([
      '1: "Ready?": a ❔ widget needs its checkbox list before the next heading',
    ])
  })

  it("a boolean with more than one checkbox", () => {
    expect(messages("## ❔ Ready?\n\n- [ ] Yes\n- [ ] No\n")).toEqual([
      '1: "Ready?": a boolean widget has exactly one checkbox, found 2',
    ])
  })

  it("a single select with two answers", () => {
    expect(messages("## 🔘 Pick\n\n- [x] a\n- [ ] ✏️ c\n")).toEqual([
      '1: "Pick": a single select takes one answer, 2 are given',
    ])
  })

  it("a custom answer that is not last", () => {
    expect(messages("## ☑️ Pick\n\n- [ ] ✏️\n- [ ] a\n")).toEqual([
      '3: "Pick": the ✏️ custom answer must be the last item',
    ])
  })

  it("a select with only a custom answer", () => {
    expect(messages("## 🔘 Pick\n\n- [ ] ✏️\n")).toEqual([
      '1: "Pick": a select needs at least one option',
    ])
  })

  it("a list item without a checkbox", () => {
    expect(messages("## ☑️ Pick\n\n- [ ] a\n- b\n")).toEqual([
      '4: "Pick": every item of a widget\'s list must be a checkbox (`- [ ] …`)',
    ])
  })

  it("a review item that is not a hunk pointer", () => {
    expect(messages("## 🔍 Chunk\n\n- [ ] src/a.ts#1-2\n- [ ] ./b.ts#9-3\n")).toEqual([
      '3: "Chunk": a review checklist item must start with a hunk pointer like `./path/file.ts#10-20`',
      '4: "Chunk": hunk range ./b.ts#9-3 ends before it starts',
    ])
  })

  it("a custom answer in a boolean", () => {
    expect(messages("## ❔ Ready?\n\n- [ ] ✏️\n")).toEqual([
      '1: "Ready?": a boolean widget has no custom answer',
    ])
  })
})
