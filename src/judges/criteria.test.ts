import { describe, expect, it } from "vitest"
import { splitLabels } from "./criteria.js"

describe("splitLabels", () => {
  it("starts a label at the start, after a sentence, or after a newline", () => {
    expect(splitLabels("a: one. b: two.\nc-d: three.")).toEqual([
      ["a", "one"],
      ["b", "two."],
      ["c-d", "three."],
    ])
  })
  it("allows indentation, blank lines and CRLF before a label, trimming each description", () => {
    expect(splitLabels("\n    a: one.\r\n\n    b: two.\n")).toEqual([
      ["a", "one."],
      ["b", "two."],
    ])
  })
  it("drops text before the first label", () => {
    expect(splitLabels("Pick one. a: x. b: y")).toEqual([
      ["a", "x"],
      ["b", "y"],
    ])
  })
})
