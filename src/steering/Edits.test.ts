import { describe, expect, it } from "vitest"
import { applySteeringEdits } from "./Edits.js"

describe("applySteeringEdits", () => {
  it("splices edits back-to-front so earlier offsets stay valid", () => {
    const content = "abc\ndef\n"
    const edits = [
      {
        range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } },
        newText: "X",
      },
      {
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
        newText: "Y",
      },
    ]
    expect(applySteeringEdits(content, edits)).toBe("aXbc\nYdef\n")
  })
})
