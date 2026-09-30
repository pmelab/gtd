import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { isSeededValidateCommand, seededValidateCommand } from "./SteeringFormats.js"
import { BUILT_IN_MODE_NAMES } from "./steering/index.js"

describe("seededValidateCommand / isSeededValidateCommand", () => {
  it("recognizes its own seeded command for every built-in mode", () => {
    fc.assert(
      fc.property(fc.constantFrom(...BUILT_IN_MODE_NAMES), (mode) => {
        expect(isSeededValidateCommand(mode, seededValidateCommand(mode))).toBe(true)
      }),
    )
  })

  it("rejects a hand-written command", () => {
    expect(isSeededValidateCommand("qa", "npx prettier --check $GTD_FILE")).toBe(false)
  })

  it("rejects another mode's seeded command", () => {
    expect(isSeededValidateCommand("review", seededValidateCommand("qa"))).toBe(false)
  })

  it("rejects near-miss whitespace/quoting variants", () => {
    expect(isSeededValidateCommand("qa", "gtd check qa  '$GTD_FILE'")).toBe(false)
    expect(isSeededValidateCommand("qa", "gtd check qa $GTD_FILE")).toBe(false)
  })
})
