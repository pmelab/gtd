import { describe, expect, it } from "vitest"
import { skills } from "./skills.js"
import { unified } from "./index.js"

const { defaults } = unified

const bundled = skills(defaults)

// Pins the lists by scope full name. It never runs the real flow, so a
// scope rename is caught by the e2e features that rest on these names
// (default-workflow, state-skills, scope-skills, quality-review-lap), not here.
describe("the bundled workflow's skills export", () => {
  it("declares exactly the bundled scopes under the default qualityReviews", () => {
    expect(Object.keys(bundled).sort()).toEqual(
      [
        "design",
        "architecture",
        "architecture.decompose",
        "packages.item",
        "packages.item.fix.suite",
        "packages.item.health",
        "build",
        "build.health",
        "build.fix.quality",
        "build.review",
        "build.review.fix.nits",
        "build.review.fix.risks",
        "build.quality.correctness",
        "build.quality.owasp-security",
        "build.quality.ponytail-review",
        "build.quality.test-audit",
        "build.quality.conventions",
        "build.quality.spec-challenge",
      ].sort(),
    )
  })

  it("keys no group scope", () => {
    for (const group of ["packages.item.fix", "build.fix", "build.review.fix", "build.quality"]) {
      expect(bundled).not.toHaveProperty(group)
    }
  })

  it("pins each scope's list", () => {
    expect(bundled).toMatchObject({
      design: ["spec-driven-development", "planning-and-task-breakdown"],
      architecture: ["api-and-interface-design", "documentation-and-adrs", "ponytail"],
      "architecture.decompose": ["incremental-implementation", "planning-and-task-breakdown"],
      "packages.item": ["test-driven-development", "incremental-implementation"],
      "packages.item.fix.suite": ["debugging-and-error-recovery"],
      "packages.item.health": ["debugging-and-error-recovery"],
      build: ["debugging-and-error-recovery"],
      "build.health": ["debugging-and-error-recovery"],
      "build.fix.quality": ["incremental-implementation", "code-simplification"],
      "build.review": ["code-review-and-quality"],
      "build.review.fix.nits": ["incremental-implementation", "code-simplification"],
      "build.review.fix.risks": ["debugging-and-error-recovery", "incremental-implementation"],
    })
  })

  it("loads one lens skill per quality lens: correctness its review skill, conventions and spec-challenge none, any other itself", () => {
    expect(bundled["build.quality.correctness"]).toEqual(["code-review-and-quality"])
    expect(bundled["build.quality.conventions"]).toEqual([])
    expect(bundled["build.quality.spec-challenge"]).toEqual([])
    expect(bundled["build.quality.owasp-security"]).toEqual(["owasp-security"])
  })

  it("keys one lens scope per qualityReviews entry", () => {
    const custom = skills({ ...defaults, qualityReviews: " my-lens ,, correctness" })
    expect(
      Object.keys(custom)
        .filter((k) => k.startsWith("build.quality."))
        .sort(),
    ).toEqual(["build.quality.correctness", "build.quality.my-lens"])
  })
})
