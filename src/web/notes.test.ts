import { describe, expect, it } from "vitest"
import type { SteeringAnchor, SteeringViewNode } from "../steering/index.js"
import { existingNoteFor } from "./notes.js"

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
