import { describe, expect, it } from "vitest"
import { agentFindings, answerFindings } from "./WidgetRules.js"
import { parseWidgets } from "./index.js"

const lines = (...ls: string[]): string => `${ls.join("\n")}\n`
const answers = (content: string): string[] =>
  answerFindings(parseWidgets(content)).map((f) => `${(f.line ?? -1) + 1}: ${f.message}`)
const agent = (content: string, options?: Parameters<typeof agentFindings>[1]): string[] =>
  agentFindings(parseWidgets(content), options).map(
    (f) => `${f.line === undefined ? "-" : f.line + 1}: ${f.message}`,
  )

describe("answerFindings", () => {
  it("requires an answer to a single select", () => {
    expect(answers(lines("## 🔘 Store?", "", "- [ ] Redis", "- [ ] ✏️"))).toEqual([
      '1: "Store?": pick one option or write a ✏️ answer, or add an annotation to send it back',
    ])
  })

  it("accepts a ticked option or a written custom answer", () => {
    expect(answers(lines("## 🔘 Store?", "", "- [x] Redis"))).toEqual([])
    expect(answers(lines("## 🔘 Store?", "", "- [ ] Redis", "- [ ] ✏️ none of these"))).toEqual([])
  })

  it("requires every hunk of a review checklist", () => {
    expect(answers(lines("## 🔍 Chunk", "", "- [x] ./a.ts#1-2", "- [ ] ./b.ts#3-4"))).toEqual([
      '1: "Chunk": tick every hunk (1 unticked), or add an annotation to send it back',
    ])
  })

  it("leaves multi selects and booleans optional", () => {
    expect(answers(lines("## ☑️ Which?", "", "- [ ] a", "", "## ❔ Ok?", "", "- [ ] Yes"))).toEqual(
      [],
    )
  })

  it("lifts every requirement once the file is annotated", () => {
    expect(
      answers(lines("Intro.[^1]", "", "## 🔘 Store?", "", "- [ ] Redis", "", "[^1]: Why at all?")),
    ).toEqual([])
  })
})

describe("agentFindings", () => {
  it("refuses an annotation left in the file", () => {
    expect(agent(lines("Intro.[^1]", "", "[^1]: Why?"))).toEqual([
      "3: annotation [^1] is still in the file: work what it says into the document, then remove the marker and its note",
    ])
  })

  it("refuses a widget kind the step does not allow", () => {
    expect(
      agent(lines("# T", "", "## ❔ Ok?", "", "- [ ] Yes"), { allow: ["single-select"] }),
    ).toEqual(['3: "Ok?": this step does not take a ❔ boolean widget; use single-select'])
  })

  it("refuses a hunk pointer outside the diff and, with coverage, an unlisted change", () => {
    const content = lines("## 🔍 Chunk", "", "- [ ] ./a.ts#1-5", "- [ ] ./b.ts#10-12")
    const diff = [
      { path: "a.ts", start: 3, end: 4 },
      { path: "c.ts", start: 1, end: 9 },
    ]
    expect(agent(content, { diff })).toEqual([
      "4: ./b.ts#10-12 is not part of the change under review: point at lines the diff changes",
    ])
    expect(agent(content, { diff, coverage: true })).toEqual([
      "4: ./b.ts#10-12 is not part of the change under review: point at lines the diff changes",
      "-: ./c.ts#1-9 is changed but no 🔍 widget lists it",
    ])
  })
})
