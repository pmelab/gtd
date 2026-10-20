import { describe, expect, it } from "vitest"
import {
  conflictFor,
  conflictTitle,
  parseStandards,
  renderStandards,
  standardsBlock,
} from "./standards.js"

const conflict = { text: "Calculators are functions.", olds: ["Calculators are classes."] }

describe("standards file", () => {
  it("round-trips decided and undecided standards", () => {
    const standards = { decided: ["Prefer early returns."], undecided: [conflict] }
    expect(parseStandards(renderStandards(standards))).toEqual(standards)
  })

  it("reads a hand-edited file: any heading groups decided ones, wrapped lines join", () => {
    const text = [
      "# Standards",
      "",
      "Some prose.",
      "",
      "## Testing",
      "",
      "* Every bug fix",
      "  gets a test.",
      "",
      "## Undecided",
      "",
      "- New",
      "  - contradicts: Old",
    ].join("\n")
    expect(parseStandards(text)).toEqual({
      decided: ["Every bug fix gets a test."],
      undecided: [{ text: "New", olds: ["Old"] }],
    })
  })
})

describe("a formatter-wrapped file", () => {
  it("keeps a wrapped contradicts line with its old standard", () => {
    const text = [
      "## Undecided",
      "",
      "- Calculators are plain functions. (re: subtract has no class)",
      "  - contradicts: Won't fix: subtract has no class — Calculators read better as",
      "    classes.",
    ].join("\n")
    expect(parseStandards(text).undecided).toEqual([
      {
        text: "Calculators are plain functions. (re: subtract has no class)",
        olds: ["Won't fix: subtract has no class — Calculators read better as classes."],
      },
    ])
  })
})

describe("conflict notes", () => {
  it("title back to the conflict it asks about", () => {
    const standards = { decided: [], undecided: [conflict] }
    expect(conflictFor(standards, conflictTitle(conflict))).toBe(conflict)
    expect(conflictFor(standards, "Standard conflict 00000000")).toBeUndefined()
  })
})

describe("standardsBlock", () => {
  it("is empty without decided standards", () => {
    expect(standardsBlock(undefined)).toBe("")
    expect(standardsBlock(renderStandards({ decided: [], undecided: [conflict] }))).toBe("")
  })

  it("lists only the decided ones", () => {
    const block = standardsBlock(renderStandards({ decided: ["A."], undecided: [conflict] }))
    expect(block).toContain("- A.")
    expect(block).not.toContain(conflict.text)
  })
})
