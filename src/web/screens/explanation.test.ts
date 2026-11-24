import { describe, expect, it } from "vitest"
import type { InlineNode } from "../../steering/index.js"
import { linksOfItems, linksOfParagraph } from "./explanation.js"

const text = (value: string): InlineNode => ({ kind: "text", value })
const link = (href: string, label: string): InlineNode => ({
  kind: "link",
  href,
  children: [text(label)],
})

describe("hunk link explanation", () => {
  it("takes a list item's text without the link and its leading dash", () => {
    const item = {
      text: "",
      inline: [link("./a.ts#3-9", "./a.ts#3-9"), text(" — validates the invite")],
    }
    expect(linksOfItems([item])).toEqual([
      { href: "./a.ts#3-9", explanation: [text("validates the invite")] },
    ])
  })

  it("takes only the sentence of a paragraph that holds the link", () => {
    const inline = [
      text("First thing. Look at "),
      link("./a.ts#1-2", "a.ts#1-2"),
      text(" for X. Last."),
    ]
    expect(linksOfParagraph(inline)).toEqual([
      { href: "./a.ts#1-2", explanation: [text("Look at for X.")] },
    ])
  })

  it("falls back to the link's own text when it is not the path", () => {
    const item = { text: "", inline: [link("./a.ts#3-9", "the invite check")] }
    expect(linksOfItems([item])).toEqual([
      { href: "./a.ts#3-9", explanation: [text("the invite check")] },
    ])
  })

  it("has no explanation when only the path is there", () => {
    const item = { text: "", inline: [link("./a.ts#3-9", "./a.ts#3-9")] }
    expect(linksOfItems([item])).toEqual([{ href: "./a.ts#3-9" }])
  })
})
