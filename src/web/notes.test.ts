import { describe, expect, it, vi } from "vitest"
import type { SteeringAnchor, SteeringViewNode } from "../steering/index.js"
import { existingNoteFor, optimisticNoteSave } from "./notes.js"

const paragraph = (line: number, note?: string): SteeringViewNode => ({
  title: `line ${line}`,
  anchor: { kind: "paragraph", line },
  ...(note !== undefined ? { note } : {}),
})

const at = (line: number): SteeringAnchor => ({ kind: "paragraph", line })

describe("existingNoteFor", () => {
  it("prefers a locally-saved override over the file's own note", () => {
    expect(existingNoteFor([paragraph(4, "from the file")], at(4), { 4: "just typed" })).toBe(
      "just typed",
    )
  })

  it("finds a note on a block riding in another node's body, not just the top level", () => {
    const question: SteeringViewNode = {
      title: "Which option?",
      anchor: { kind: "question", index: 0 },
      body: [paragraph(9, "body block note")],
    }
    expect(existingNoteFor([question], at(9), {})).toBe("body block note")
  })

  it("has nothing to pre-fill for a non-paragraph anchor", () => {
    expect(
      existingNoteFor([paragraph(1, "x")], { kind: "chunk", index: 0 }, { 1: "y" }),
    ).toBeUndefined()
  })
})

describe("optimisticNoteSave", () => {
  it("shows the note and closes the sheet before the write resolves", () => {
    const setOverrides = vi.fn()
    const close = vi.fn()
    optimisticNoteSave({
      setOverrides,
      close,
      write: () => new Promise(() => {}),
    })(at(2), "a note")
    expect(close).toHaveBeenCalled()
    const update = setOverrides.mock.calls[0]![0] as (prev: Record<number, string>) => unknown
    expect(update({})).toEqual({ 2: "a note" })
  })

  it("reverts the override and reports the refusal when the write is rejected", async () => {
    const setOverrides = vi.fn()
    const onRefusal = vi.fn()
    const write = vi.fn(() => Promise.reject(new Error("refused")))
    optimisticNoteSave({ setOverrides, close: () => {}, write, onRefusal })(at(2), "a note")
    await vi.waitFor(() => expect(onRefusal).toHaveBeenCalled())
    const revert = setOverrides.mock.calls[1]![0] as (prev: Record<number, string>) => unknown
    expect(revert({ 2: "a note" })).toEqual({})
  })

  it("still shows and closes with no write wired up at all (a pure-data screen)", () => {
    const close = vi.fn()
    expect(() => optimisticNoteSave({ setOverrides: vi.fn(), close })(at(1), "x")).not.toThrow()
    expect(close).toHaveBeenCalled()
  })
})
