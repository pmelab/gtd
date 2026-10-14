import { describe, expect, it } from "vitest"
import { configure } from "../../flows/index.js"
import * as workflows from "../index.js"

const { defaults, envDefaults, feature, fix, review, ShippedOptions } = workflows

describe("the shipped workflow factories", () => {
  it("take exactly the settings the shipped workflows declare as options", () => {
    expect(Object.keys(ShippedOptions.fields).sort()).toEqual(
      [...Object.keys(defaults), ...Object.keys(envDefaults)].sort(),
    )
  })

  it("lay each option over the shipped setting of its own kind", () => {
    const result = configure(feature({ qualityReviews: "correctness", testCommand: "npm run ci" }))
    expect(result).toMatchObject({
      ok: true,
      build: {
        defaults: { ...defaults, qualityReviews: "correctness" },
        envDefaults: { ...envDefaults, testCommand: "npm run ci" },
      },
    })
  })

  it("default reviewSeverityMinP to 0.7 and let a factory override win", () => {
    expect(defaults.reviewSeverityMinP).toBe("0.7")
    expect(configure(feature({ reviewSeverityMinP: "0.9" }))).toMatchObject({
      ok: true,
      build: { defaults: { reviewSeverityMinP: "0.9" } },
    })
  })

  it("build the shipped settings unchanged with no options", () => {
    for (const factory of [feature, fix, review]) {
      expect(configure(factory)).toMatchObject({ ok: true, build: { defaults, envDefaults } })
    }
  })

  it("reject a misspelled option, at the type level and at load, naming the known ones", () => {
    // @ts-expect-error — `testComand` is no option
    const configured = feature({ testComand: "npm test" })
    const result = configure(configured)
    expect(result).toMatchObject({ ok: false, issues: [{ path: ["testComand"] }] })
    expect(result?.ok === false && result.issues[0]?.message).toMatch(
      /^is unexpected, expected: .*"testCommand"/,
    )
  })

  it("reject a removed option at the type level and at load", () => {
    // @ts-expect-error — `model` was never (or is no longer) an option
    const result = configure(review({ model: "smart" }))
    expect(result).toMatchObject({ ok: false, issues: [{ path: ["model"] }] })
  })

  it("reject a value of the wrong type at the type level and at load", () => {
    // @ts-expect-error — settings are strings
    const result = configure(fix({ judgeBudgetBytes: 65536 }))
    expect(result).toMatchObject({ ok: false, issues: [{ path: ["judgeBudgetBytes"] }] })
  })
})
