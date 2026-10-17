import { describe, expect, it } from "vitest"
import { sliceRanges, type SliceSpan } from "./Slices.js"

const span = (name: string, enteredAt: string, leftAt?: string): SliceSpan => ({
  name,
  enteredAt,
  leftAt,
})
const running = { base: "B", tip: "T" }

describe("sliceRanges", () => {
  it("two adjacent spans: first from episode.base to its leftAt, second from there to episode.tip", () => {
    expect(sliceRanges([span("a", "B", "c2"), span("b", "c2", "T")], running)).toEqual([
      { name: "a", base: "B", tip: "c2", open: false },
      { name: "b", base: "c2", tip: "T", open: true },
    ])
  })

  it("a leading gap folds into the first range via episode.base", () => {
    expect(sliceRanges([span("a", "c1", "c2")], running)).toEqual([
      { name: "a", base: "B", tip: "T", open: true },
    ])
  })

  it("an inner gap folds into the next range: its base is the previous leftAt", () => {
    expect(sliceRanges([span("a", "B", "c1"), span("b", "c3", "T")], running)).toEqual([
      { name: "a", base: "B", tip: "c1", open: false },
      { name: "b", base: "c1", tip: "T", open: true },
    ])
  })

  it("a trailing gap folds back: the last range's tip is the episode tip, and it stays open", () => {
    expect(sliceRanges([span("a", "B", "c1")], running)).toEqual([
      { name: "a", base: "B", tip: "T", open: true },
    ])
  })

  it("drops a closed empty span, first, middle and last, its neighbours absorbing the gap", () => {
    expect(sliceRanges([span("e", "B", "B"), span("a", "B", "c1")], running)).toEqual([
      { name: "a", base: "B", tip: "T", open: true },
    ])
    expect(
      sliceRanges([span("a", "B", "c1"), span("e", "c2", "c2"), span("b", "c2", "c4")], running),
    ).toEqual([
      { name: "a", base: "B", tip: "c1", open: false },
      { name: "b", base: "c1", tip: "T", open: true },
    ])
    expect(sliceRanges([span("a", "B", "c1"), span("e", "c1", "c1")], running)).toEqual([
      { name: "a", base: "B", tip: "T", open: true },
    ])
  })

  it("no spans, and only empty closed spans, each yield one open main range over the whole episode", () => {
    const main = [{ name: "main", base: "B", tip: "T", open: true }]
    expect(sliceRanges([], running)).toEqual(main)
    expect(sliceRanges([span("e", "c1", "c1")], running)).toEqual(main)
  })

  it("an unleft empty span is kept and open", () => {
    expect(sliceRanges([span("a", "B", "c1"), span("b", "c1")], running)).toEqual([
      { name: "a", base: "B", tip: "c1", open: false },
      { name: "b", base: "c1", tip: "T", open: true },
    ])
    expect(sliceRanges([span("b", "T")], running)).toEqual([
      { name: "b", base: "B", tip: "T", open: true },
    ])
  })

  it("rejects a pending turn's empty hash", () => {
    expect(() => sliceRanges([span("a", "", "c1")], running)).toThrow("not a commit")
    expect(() => sliceRanges([span("a", "c1", "")], running)).toThrow("not a commit")
  })
})
