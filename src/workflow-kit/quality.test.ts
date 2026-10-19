import { describe, expect, it } from "vitest"
import { lensEntriesOf, lensesOf, lensOf, lensScopes } from "./quality.js"

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

describe("lensEntriesOf", () => {
  it("keeps each entry whole, hint included", () => {
    expect(lensEntriesOf(" a = smart ,, b, =x")).toEqual(["a = smart", "b"])
  })
})

describe("lensOf", () => {
  it("splits an entry at its first =, both sides trimmed", () => {
    expect(lensOf(" plugin:b = vendor=x ")).toEqual({ lens: "plugin:b", model: "vendor=x" })
  })

  it("an entry without = has a blank hint", () => {
    expect(lensOf("a")).toEqual({ lens: "a", model: "" })
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
