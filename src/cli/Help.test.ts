import { describe, expect, it } from "vitest"
import { closest, definition, wrap } from "./Help.js"

describe("wrap", () => {
  it("fills lines up to the width, never past it", () => {
    expect(wrap("aaa bbb ccc ddd", 7)).toEqual(["aaa bbb", "ccc ddd"])
  })

  it("keeps a code span on one line", () => {
    expect(wrap("run `gtd help land` now", 12)).toEqual(["run", "`gtd help land`", "now"])
  })

  it("keeps an indented example paragraph verbatim", () => {
    expect(wrap('text\n\n  s=$(x) && sh -c "$s"', 4)).toEqual([
      "text",
      "",
      '  s=$(x) && sh -c "$s"',
    ])
  })
})

describe("definition", () => {
  it("puts a short term beside its description", () => {
    expect(definition("next", "Print it", 10)).toEqual(["  next    Print it"])
  })

  it("gives a term too wide for the column a line of its own", () => {
    expect(definition("a-very-long-term", "Text", 10)).toEqual([
      "  a-very-long-term",
      "          Text",
    ])
  })
})

describe("closest", () => {
  const commands = ["next", "land", "history", "help"]

  it("finds a dropped letter and a swapped pair", () => {
    expect(closest("nxt", commands)).toBe("next")
    expect(closest("lnad", commands)).toBe("land")
    expect(closest("histroy", commands)).toBe("history")
  })

  it("suggests nothing for a word unlike every candidate", () => {
    expect(closest("frobnicate", commands)).toBeUndefined()
  })
})
