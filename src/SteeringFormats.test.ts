import { describe, expect, it } from "vitest"
import { builtInModeNames, steeringFormatFor } from "./SteeringFormats.js"
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
