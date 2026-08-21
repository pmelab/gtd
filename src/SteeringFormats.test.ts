import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  builtInModeNames,
  isSeededValidateCommand,
  seededValidateCommand,
  steeringFormatFor,
} from "./SteeringFormats.js"
import { QA_FORMAT } from "./OpenQuestions.js"
import { REVIEW_FORMAT } from "./ReviewDoc.js"

describe("builtInModeNames", () => {
  it("lists the two built-in format names", () => {
    expect(builtInModeNames()).toEqual(["qa", "review"])
  })
})

describe("steeringFormatFor", () => {
  it("resolves 'qa' and 'review' to their singleton formats", () => {
    expect(steeringFormatFor("qa")).toBe(QA_FORMAT)
    expect(steeringFormatFor("review")).toBe(REVIEW_FORMAT)
  })

  it("resolves an unknown name to undefined", () => {
    expect(steeringFormatFor("prose")).toBeUndefined()
    expect(steeringFormatFor("adr")).toBeUndefined()
  })
})

describe("seededValidateCommand / isSeededValidateCommand", () => {
  it("recognizes its own seeded command for every built-in mode", () => {
    fc.assert(
      fc.property(fc.constantFrom(...builtInModeNames()), (mode) => {
        expect(isSeededValidateCommand(mode, seededValidateCommand(mode))).toBe(true)
      }),
    )
  })

  it("rejects a hand-written command", () => {
    expect(isSeededValidateCommand("qa", "npx prettier --check <%= it.file %>")).toBe(false)
  })

  it("rejects another mode's seeded command", () => {
    expect(isSeededValidateCommand("review", seededValidateCommand("qa"))).toBe(false)
  })

  it("rejects near-miss whitespace/quoting variants", () => {
    expect(isSeededValidateCommand("qa", "gtd check qa  '<%= it.file %>'")).toBe(false)
    expect(isSeededValidateCommand("qa", `gtd check qa "<%= it.file %>"`)).toBe(false)
  })
})

describe("every registry entry's sample", () => {
  // Load-bearing, not a nicety (see the package's own doc comment on this
  // acceptance criterion): `src/ModeContradiction.ts` round-trips this exact
  // sample through a mode's declared `format:` command, then re-validates it
  // — a sample that doesn't validate clean to begin with would hard-stop
  // every prompt beat that declares `file:`+`mode:`, at 3 wasted agent turns
  // each, with no way to tell a real contradiction from a drifted fixture.
  it("validates clean under its own format's parser", () => {
    for (const mode of builtInModeNames()) {
      const format = steeringFormatFor(mode)!
      expect(format.validate(format.sample)).toEqual([])
    }
  })
})
