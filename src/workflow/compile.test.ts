import { describe, expect, it } from "vitest"
import { compileConfig, type ConfigLayer } from "./compile.js"

const layer = (value: unknown, origin = "/repo/.gtdrc"): ConfigLayer => ({
  origin,
  dir: "/repo",
  value,
})

describe("compileConfig: skills: shape validation", () => {
  it("rejects a non-object skills:, dropping it to {} while reporting the shape", () => {
    const compiled = compileConfig([layer({ skills: "nope" })])
    expect(compiled.rcSkills).toEqual({})
    const found = compiled.diagnostics.find((d) => d.path.join(".") === "skills")
    expect(found?.message).toContain(
      '"skills" must be a mapping of step name -> array of skill names',
    )
    expect(found?.message).toContain("got string")
  })

  it("rejects an entry whose value is a string instead of an array, dropping only that key — a sibling good key survives", () => {
    const compiled = compileConfig([
      layer({
        skills: {
          "build.fix": "debugging-and-error-recovery",
          "build.review.reviewing": ["code-review-and-quality"],
        },
      }),
    ])
    expect(compiled.rcSkills).toEqual({ "build.review.reviewing": ["code-review-and-quality"] })
    const found = compiled.diagnostics.find((d) => d.path.join(".") === "skills.build.fix")
    expect(found?.message).toContain('"skills.build.fix" must be an array of skill names (strings)')
    expect(found?.message).toContain("got string")
  })

  it("rejects an entry whose array holds a non-string element, dropping only that key — a sibling good key survives", () => {
    const compiled = compileConfig([
      layer({
        skills: {
          "build.fix": ["debugging-and-error-recovery", 42],
          "build.review.reviewing": ["code-review-and-quality"],
        },
      }),
    ])
    expect(compiled.rcSkills).toEqual({ "build.review.reviewing": ["code-review-and-quality"] })
    const found = compiled.diagnostics.find((d) => d.path.join(".") === "skills.build.fix")
    expect(found?.message).toContain('"skills.build.fix" must be an array of skill names (strings)')
  })

  it("accepts a well-shaped skills: map untouched, with no diagnostic", () => {
    const compiled = compileConfig([layer({ skills: { "build.fix": ["my-org-runbook"] } })])
    expect(compiled.rcSkills).toEqual({ "build.fix": ["my-org-runbook"] })
    expect(compiled.diagnostics).toEqual([])
  })
})
