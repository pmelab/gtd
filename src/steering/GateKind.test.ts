import { describe, expect, it } from "vitest"
import { gateKind } from "./GateKind.js"

describe("gateKind", () => {
  it("names the kind after the file", () => {
    expect(gateKind(".gtd/REVIEW.md")).toBe("Review")
    expect(gateKind(".gtd/SQUASH_MESSAGE.md")).toBe("Squash message")
    expect(gateKind("NOTES")).toBe("Notes")
  })
})
