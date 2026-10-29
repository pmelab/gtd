import { describe, expect, it } from "vitest"
import { ownFlagRefusal, resolveStartVars, resolveVars } from "./vars.js"

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

  it("GTD_FLAG_X never overrides one of gtd's own flags, while GTD_<NAME> still does for other names", () => {
    expect(
      resolveStartVars(
        { flag_x: "0", a: "1" },
        { flag_x: "0" },
        {},
        { GTD_FLAG_X: "1", GTD_A: "2" },
      ),
    ).toEqual({ flag_x: "0", a: "2" })
  })

  it("pins a workflow's own flag from GTD_FLAG_<NAME>, below --var", () => {
    expect(resolveStartVars({ flag_own: "0" }, {}, {}, { GTD_FLAG_OWN: "true" })).toEqual({
      flag_own: "1",
    })
    expect(
      resolveStartVars({ flag_own: "0" }, {}, { flag_own: "0" }, { GTD_FLAG_OWN: "1" }),
    ).toEqual({
      flag_own: "0",
    })
    expect(resolveStartVars({ flag_own: "1" }, {}, {}, {})).toEqual({ flag_own: "1" })
  })
})

describe("ownFlagRefusal", () => {
  it("refuses a workflow's own flag set to anything but 1, 0, true or false", () => {
    expect(ownFlagRefusal({ flag_own: "0" }, {}, { GTD_FLAG_OWN: "yes" })).toBe(
      "GTD_FLAG_OWN must be 1, 0, true or false",
    )
    expect(ownFlagRefusal({ flag_own: "0" }, {}, { GTD_FLAG_OWN: "TRUE" })).toBeUndefined()
    expect(ownFlagRefusal({ flag_x: "0" }, { flag_x: "1" }, { GTD_FLAG_X: "yes" })).toBeUndefined()
  })
})
