import { describe, expect, it } from "vitest"
import { driveRefusalFrom, writeRefusalFrom } from "./api.js"

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

describe("driveRefusalFrom", () => {
  it("reads the reason off error.data.driveRefusal", () => {
    const error = { data: { driveRefusal: { reason: "already-driving" } } }
    expect(driveRefusalFrom(error)).toEqual({ reason: "already-driving" })
  })

  it("returns undefined for an error with no driveRefusal data", () => {
    expect(driveRefusalFrom({ data: {} })).toBeUndefined()
    expect(driveRefusalFrom({})).toBeUndefined()
    expect(driveRefusalFrom(null)).toBeUndefined()
    expect(driveRefusalFrom("boom")).toBeUndefined()
    expect(driveRefusalFrom(new Error("network error"))).toBeUndefined()
  })

  it("returns undefined for a writeRefusal-shaped error (the done mutation's other half)", () => {
    const error = { data: { writeRefusal: { reason: "stale-token" } } }
    expect(driveRefusalFrom(error)).toBeUndefined()
  })

  it("returns undefined for an unrecognized reason string", () => {
    const error = { data: { driveRefusal: { reason: "something-else" } } }
    expect(driveRefusalFrom(error)).toBeUndefined()
  })
})
