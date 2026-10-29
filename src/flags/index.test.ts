import { describe, expect, it } from "vitest"
import { FLAGS, flagSettings, resolveFlags, type FlagDeclaration, type Flags } from "./index.js"

const registry = [
  { name: "alpha", owner: "pmelab", expiry: "2020-01-01", kind: "release" },
  { name: "new_review", owner: "pmelab", expiry: "2099-01-01", kind: "ops" },
] as const satisfies readonly FlagDeclaration[]

describe("resolveFlags", () => {
  it.each(["1", "true", "TRUE", "True"])("%s turns a flag on", (value) => {
    expect(resolveFlags({ GTD_FLAG_ALPHA: value }, registry).alpha).toBe(true)
  })

  it.each(["0", "false", "FALSE"])("%s turns a flag off", (value) => {
    expect(resolveFlags({ GTD_FLAG_ALPHA: value }, registry).alpha).toBe(false)
  })

  it("reads unset and empty as off, with every declared flag a key", () => {
    expect(resolveFlags({ GTD_FLAG_NEW_REVIEW: "" }, registry)).toEqual({
      alpha: false,
      new_review: false,
    })
  })

  it.each(["ture", "constructor", "__proto__", "toString"])(
    "throws naming the variable, not the value %s",
    (value) => {
      expect(() => resolveFlags({ GTD_FLAG_NEW_REVIEW: value }, registry)).toThrow(
        /^GTD_FLAG_NEW_REVIEW must be 1, 0, true or false$/,
      )
    },
  )

  it("reports the first garbled flag in registry order", () => {
    expect(() => resolveFlags({ GTD_FLAG_NEW_REVIEW: "x", GTD_FLAG_ALPHA: "y" }, registry)).toThrow(
      /^GTD_FLAG_ALPHA /,
    )
  })

  it("ignores an undeclared GTD_FLAG_* key with a garbled value", () => {
    expect(() => resolveFlags({ GTD_FLAG_NOPE: "ture" }, registry)).not.toThrow()
  })

  it("resolves a flag past its expiry like any other", () => {
    expect(registry[0].expiry < new Date().toISOString().slice(0, 10)).toBe(true)
    expect(resolveFlags({ GTD_FLAG_ALPHA: "1" }, registry).alpha).toBe(true)
    expect(resolveFlags({ GTD_FLAG_ALPHA: "0" }, registry).alpha).toBe(false)
    expect(resolveFlags({}, registry).alpha).toBe(false)
  })

  it("Flags<R> rejects a misspelt name", () => {
    const flags: Flags<typeof registry> = resolveFlags({}, registry)
    // @ts-expect-error misspelt flag name
    void flags.alpah
  })
})

describe("resolveFlags defaultOn", () => {
  const on = [
    { name: "beta", owner: "pmelab", expiry: "2099-01-01", kind: "release", defaultOn: true },
  ] as const satisfies readonly FlagDeclaration[]

  it.each([undefined, ""])("reads unset or empty (%j) as on", (value) => {
    expect(resolveFlags({ GTD_FLAG_BETA: value }, on).beta).toBe(true)
  })

  it.each(["0", "false", "FALSE"])("%s still forces a default-on flag off", (value) => {
    expect(resolveFlags({ GTD_FLAG_BETA: value }, on).beta).toBe(false)
  })

  it.each(["1", "true"])("%s forces a default-on flag on", (value) => {
    expect(resolveFlags({ GTD_FLAG_BETA: value }, on).beta).toBe(true)
  })

  it("still throws for a garbled value", () => {
    expect(() => resolveFlags({ GTD_FLAG_BETA: "ture" }, on)).toThrow(
      /^GTD_FLAG_BETA must be 1, 0, true or false$/,
    )
  })

  it("reads an entry without defaultOn as off when unset", () => {
    expect(resolveFlags({}, [...on, ...registry]).alpha).toBe(false)
  })
})

describe("FLAGS", () => {
  it("declares settable, unique variable names", () => {
    // Vacuous while FLAGS is empty; guards the first declared flag.
    const names = (FLAGS as readonly FlagDeclaration[]).map(({ name }) => {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
      return name
    })
    expect(new Set(names).size).toBe(names.length)
  })
})

describe("flagSettings", () => {
  it('maps every flag to "1" or "0" under flag_<name>', () => {
    expect(flagSettings({ alpha: true, new_review: false })).toEqual({
      flag_alpha: "1",
      flag_new_review: "0",
    })
  })
})
