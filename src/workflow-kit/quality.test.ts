import { describe, expect, it } from "vitest"
import { lensesOf, lensScopes } from "./quality.js"

describe("lensesOf", () => {
  it("splits on commas, trims, drops blanks", () => {
    expect(lensesOf(" a ,, b,")).toEqual(["a", "b"])
  })
})

describe("lensScopes", () => {
  it("keys one entry per lens under the given scope", () => {
    expect(lensScopes("x.quality", ["a", "b"], (lens) => [lens])).toEqual({
      "x.quality.a": ["a"],
      "x.quality.b": ["b"],
    })
  })
})
