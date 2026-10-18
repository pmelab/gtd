import { describe, expect, it } from "vitest"
import { configure, type WorkflowDoors } from "../../flows/index.js"
import * as workflows from "../index.js"
import * as options from "./options.js"

const { defaults, envDefaults, feature, fix, review, ShippedOptions } = workflows
const { flagShipped } = options

describe("the shipped workflow factories", () => {
  it("take exactly the settings the shipped workflows declare as options", () => {
    expect(Object.keys(ShippedOptions.fields).sort()).toEqual(
      [...Object.keys(defaults), ...Object.keys(envDefaults)]
        .filter((name) => name !== "flag_naive_pass" && name !== "flag_risk_tier")
        .sort(),
    )
  })

  it("declare seamAllow and flag_naive_pass defaults; flag_naive_pass is no option", () => {
    expect(defaults.flag_naive_pass).toBe("0")
    expect(Object.keys(ShippedOptions.fields)).not.toContain("flag_naive_pass")
    expect(configure(feature({ seamAllow: "docs/**" }))).toMatchObject({
      ok: true,
      build: { defaults: { seamAllow: "docs/**", flag_naive_pass: "0" } },
    })
  })

  it("declare flag_risk_tier off by default; it is no factory option", () => {
    expect(defaults.flag_risk_tier).toBe("0")
    expect(Object.keys(ShippedOptions.fields)).not.toContain("flag_risk_tier")
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

  it("default refactorFlagPattern to GTD_FLAG_ matches and let a factory override win", () => {
    expect(defaults.refactorFlagPattern).toBe("\\bGTD_FLAG_\\w+")
    expect(configure(feature({ refactorFlagPattern: "\\bFF_\\w+" }))).toMatchObject({
      ok: true,
      build: { defaults: { refactorFlagPattern: "\\bFF_\\w+" } },
    })
  })

  it("build seamAllow's default from the test-file globs, byte-equal to the shipped string", () => {
    expect(defaults.seamAllow).toBe(
      "**/*.test.*, **/*.spec.*, **/*.feature, **/tests/**, **/test/**, **/__tests__/**, .gtd/**",
    )
  })

  it("default refactorQualityReviews to the three refactor lenses and let a factory option win", () => {
    expect(defaults.refactorQualityReviews).toBe("correctness, ponytail-review, conventions")
    expect(configure(feature({ refactorQualityReviews: "correctness" }))).toMatchObject({
      ok: true,
      build: { defaults: { refactorQualityReviews: "correctness" } },
    })
    expect(configure(workflows.rollout({ refactorQualityReviews: "" }))).toMatchObject({
      ok: true,
      build: { defaults: { refactorQualityReviews: "" } },
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

  describe("flagShipped", () => {
    const factory = flagShipped(async () => {}, "rollout")

    it("declare flag and flagRegistry as process settings, so --var flag= is accepted", () => {
      expect(configure(factory)).toMatchObject({
        ok: true,
        build: {
          defaults: { ...defaults, flag: "", flagRegistry: "src/flags/index.ts" },
          envDefaults,
        },
      })
    })

    it.each(["rollout", "cleanup"] as const)(
      "%s declares one door named after it, with one required flag arg",
      (name) => {
        const result = configure(workflows[name]())
        expect(result).toMatchObject({
          ok: true,
          build: { doors: { [name]: { args: [{ name: "flag" }] } } },
        })
        const build = (result as { build?: { doors?: WorkflowDoors } }).build
        expect(Object.keys(build?.doors ?? {})).toEqual([name])
        expect(build?.doors?.[name]?.vars?.({ flag: "x" })).toEqual({ flag: "x" })
      },
    )

    it.each(["rollout", "cleanup"] as const)("%s builds one door of that name", (name) => {
      const result = configure(flagShipped(async () => {}, name))
      const doors = (result as { build?: { doors?: WorkflowDoors } }).build?.doors
      expect(Object.keys(doors ?? {})).toEqual([name])
      expect(doors?.[name]?.args).toEqual([{ name: "flag" }])
      expect(doors?.[name]?.vars?.({ flag: "x" })).toEqual({ flag: "x" })
      expect(doors?.[name]?.vars?.({})).toEqual({ flag: "" })
    })

    it("fail the load on an unknown option", () => {
      // @ts-expect-error — `flag` is a --var, not an option
      const result = configure(factory({ flag: "x" }))
      expect(result).toMatchObject({ ok: false, issues: [{ path: ["flag"] }] })
    })
  })
})
