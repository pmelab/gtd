import { describe, expect, it } from "vitest"
import { reaction } from "./reaction.js"

describe("reaction", () => {
  it("throws every problem of the spec, naming the key", () => {
    expect(() =>
      reaction({
        on: { to: "eror", errorKind: [], status: "idle" },
        run: "triage",
        every: "5m",
      } as never),
    ).toThrow(
      "reaction.every: is not a known key; reaction.on.to: must be one of needsYou, working, error, idle, cleaned, or an array of them; reaction.on.errorKind: must be one of stalled, crashed, driver, note, or an array of them; reaction.on.status: is not a known key; reaction.run: must be a function",
    )
  })

  it("requires on and run", () => {
    expect(() => reaction({} as never)).toThrow(
      "reaction.on: is required; reaction.run: must be a function",
    )
  })

  it("accepts an empty filter and arrays of values", () => {
    expect(() =>
      reaction({ on: { to: ["error", "cleaned"], project: ["portal"] }, run: () => {} }),
    ).not.toThrow()
    expect(() => reaction({ on: {}, run: () => {} })).not.toThrow()
  })
})
