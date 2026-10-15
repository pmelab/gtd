import { describe, expect, it } from "vitest"
import { resolveStartVars, resolveVars } from "./vars.js"

describe("resolveVars — GTD_FLAG_* belongs to feature flags", () => {
  it.each(["flag_x", "FLAG_X", "Flag_x"])("%s keeps its default with GTD_FLAG_X set", (name) => {
    expect(resolveVars({ [name]: "off" }, {}, { GTD_FLAG_X: "on" })).toEqual({ [name]: "off" })
  })

  it.each([
    ["flags", "GTD_FLAGS"],
    ["flagship", "GTD_FLAGSHIP"],
    ["my_flag_x", "GTD_MY_FLAG_X"],
  ])("%s still takes %s", (name, key) => {
    expect(resolveVars({ [name]: "off" }, {}, { [key]: "on" })).toEqual({ [name]: "on" })
  })
})

describe("resolveStartVars", () => {
  it("a declared flag_x takes the StartFlags value", () => {
    expect(resolveStartVars({ flag_x: "0" }, { flag_x: "1" }, {}, {})).toEqual({ flag_x: "1" })
  })

  it("never introduces an undeclared flag", () => {
    expect(resolveStartVars({ a: "1" }, { flag_x: "1" }, {}, {})).toEqual({ a: "1" })
  })

  it("--var flag_x beats the flag", () => {
    expect(resolveStartVars({ flag_x: "0" }, { flag_x: "1" }, { flag_x: "0" }, {})).toEqual({
      flag_x: "0",
    })
  })

  it("GTD_FLAG_X never overrides, while GTD_<NAME> still does for other names", () => {
    expect(
      resolveStartVars({ flag_x: "0", a: "1" }, {}, {}, { GTD_FLAG_X: "1", GTD_A: "2" }),
    ).toEqual({ flag_x: "0", a: "2" })
  })
})
