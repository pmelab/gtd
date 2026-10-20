import { describe, expect, it } from "vitest"
import { sliceCriteria, slicesOf } from "./slicing.js"

describe("slicesOf", () => {
  it("reads each level-2 heading's ID'd items, in order", () => {
    expect(
      slicesOf("# Slices\n\n## Parse\n\n- AC-1: parses\n- AC-3\n\n## Print\n\n- AC-2 prints\n"),
    ).toEqual([
      { title: "Parse", ids: ["AC-1", "AC-3"] },
      { title: "Print", ids: ["AC-2"] },
    ])
  })

  it("keeps an item not led by an ID as an empty one, and skips fenced lines", () => {
    expect(slicesOf("## One\n\n```md\n## Two\n- AC-9\n```\n- AC-10\n- see AC-1\n")).toEqual([
      { title: "One", ids: ["AC-10", ""] },
    ])
  })

  it("ends a slice at any other heading", () => {
    expect(
      slicesOf("## One\n\n- AC-1\n\n### Why\n\n- shares the lexer\n\n# Later\n\n- AC-5\n"),
    ).toEqual([{ title: "One", ids: ["AC-1"] }])
  })

  it("reads no slice from a file without level-2 headings", () => {
    expect(slicesOf("# Slices\n\n- AC-1\n")).toEqual([])
  })
})

describe("sliceCriteria", () => {
  const slices = [
    { title: "A", ids: ["AC-1", "AC-3"] },
    { title: "B", ids: ["AC-2"] },
    { title: "C", ids: ["AC-4"] },
  ]

  it("keeps an earlier slice to its own IDs", () => {
    expect(sliceCriteria(slices, 1)).toEqual({ only: ["AC-2"] })
  })

  it("gives the last slice every ID no earlier slice builds", () => {
    expect(sliceCriteria(slices, 2)).toEqual({ except: ["AC-1", "AC-3", "AC-2"] })
  })

  it("leaves a single slice unsliced", () => {
    expect(sliceCriteria([slices[0]!], 0)).toBeUndefined()
  })
})
