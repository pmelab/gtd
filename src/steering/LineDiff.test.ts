import { describe, expect, it } from "vitest"
import { changedRanges } from "./LineDiff.js"

const text = (...lines: string[]): string => `${lines.join("\n")}\n`

describe("changedRanges", () => {
  it("is empty for equal text", () => {
    expect(changedRanges(text("a", "b"), text("a", "b"))).toEqual([])
  })

  it("covers an added file", () => {
    expect(changedRanges("", text("a", "b"))).toEqual([{ start: 1, end: 2 }])
  })

  it("finds separate changed blocks", () => {
    expect(
      changedRanges(text("a", "b", "c", "d", "e"), text("a", "B", "c", "d", "E", "F")),
    ).toEqual([
      { start: 2, end: 2 },
      { start: 5, end: 6 },
    ])
  })

  it("marks a pure deletion at the line after it", () => {
    expect(changedRanges(text("a", "b", "c"), text("a", "c"))).toEqual([{ start: 2, end: 2 }])
    expect(changedRanges(text("a", "b"), text("a"))).toEqual([{ start: 1, end: 1 }])
  })

  it("keeps an inserted block between kept lines", () => {
    expect(changedRanges(text("a", "x", "c", "y"), text("a", "x", "n1", "n2", "c", "y"))).toEqual([
      { start: 3, end: 4 },
    ])
  })
})
