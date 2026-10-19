import { describe, expect, it } from "vitest"
import { lensesOf, lensModelsOf, lensScopes } from "./quality.js"

describe("lensesOf", () => {
  it("splits on commas, trims, drops blanks", () => {
    expect(lensesOf(" a ,, b,")).toEqual(["a", "b"])
  })

  it("cuts each entry's model hint off at its first =", () => {
    expect(lensesOf("a = smart, plugin:b=vendor=x, c=")).toEqual(["a", "plugin:b", "c"])
  })

  it("drops an entry with a hint but no lens", () => {
    expect(lensesOf("=smart, a")).toEqual(["a"])
  })
})

describe("lensModelsOf", () => {
  it("keys each hinted lens to its trimmed hint, everything after the first =", () => {
    expect(lensModelsOf("a = smart, plugin:b=vendor=x, c")).toEqual({
      a: "smart",
      "plugin:b": "vendor=x",
    })
  })

  it("a blank hint is no hint", () => {
    expect(lensModelsOf("a=, b= ")).toEqual({})
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
