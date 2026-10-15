import { describe, expect, it } from "vitest"
import { resolveVars } from "./vars.js"

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
