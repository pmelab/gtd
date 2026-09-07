import { describe, expect, it } from "vitest"
import { writeRefusalFrom } from "./api.js"

describe("writeRefusalFrom", () => {
  it("reads the reason and moved fields off error.data.writeRefusal", () => {
    const error = { data: { writeRefusal: { reason: "stale-token", moved: "sha" } } }
    expect(writeRefusalFrom(error)).toEqual({ reason: "stale-token", moved: "sha" })
  })

  it("omits moved when the refusal doesn't carry one", () => {
    const error = { data: { writeRefusal: { reason: "not-resting" } } }
    expect(writeRefusalFrom(error)).toEqual({ reason: "not-resting" })
  })

  it("returns undefined for an error with no writeRefusal data", () => {
    expect(writeRefusalFrom({ data: {} })).toBeUndefined()
    expect(writeRefusalFrom({})).toBeUndefined()
    expect(writeRefusalFrom(null)).toBeUndefined()
    expect(writeRefusalFrom("boom")).toBeUndefined()
    expect(writeRefusalFrom(new Error("network error"))).toBeUndefined()
  })
})
