import { describe, expect, it } from "vitest"
import { skills } from "./skills.js"
import * as workflow from "../index.js"

const { defaults } = workflow

const bundled = skills(defaults)

// Pins the lists by scope full name. It never runs the real flow, so a
// scope rename is caught by the e2e features that rest on these names
// (default-workflow, state-skills, scope-skills, quality-review-lap), not here.
describe("the bundled workflow's skills export", () => {
  it("declares exactly the bundled scopes under the default qualityReviews", () => {
    expect(Object.keys(bundled).sort()).toEqual(
      [
        "design",
        "build",
        "build.health",
        "build.fix.quality",
        "build.review",
        "build.review.fix.nits",
        "build.review.fix.risks",
        "notes",
        "refactor",
        "refactor.fix.suite",
        "refactor.health",
        "seam",
        "implement",
        "implement.fix.suite",
        "implement.health",
        "build.quality.correctness",
        "build.quality.owasp-security",
        "build.quality.ponytail-review",
        "build.quality.test-audit",
        "build.quality.conventions",
        "build.quality.spec-challenge",
        "refactor.build",
        "refactor.build.health",
        "refactor.build.fix.quality",
        "refactor.build.review",
        "refactor.build.review.fix.nits",
        "refactor.build.review.fix.risks",
        "refactor.build.quality.correctness",
        "refactor.build.quality.ponytail-review",
        "refactor.build.quality.conventions",
      ].sort(),
    )
  })

  it("keys no group scope or non-agent step", () => {
    for (const group of [
      "build.fix",
      "build.review.fix",
      "build.quality",
      "implement.fix",
      "seam.judge",
      "seam.steer",
      "seam.by-hand",
    ]) {
      expect(bundled).not.toHaveProperty(group)
    }
  })

  it("pins each scope's list", () => {
    expect(bundled).toMatchObject({
      design: ["spec-driven-development", "planning-and-task-breakdown"],
      build: ["debugging-and-error-recovery"],
      "build.health": ["debugging-and-error-recovery"],
      "build.fix.quality": ["incremental-implementation", "code-simplification"],
      "build.review": ["code-review-and-quality"],
      "build.review.fix.nits": ["incremental-implementation", "code-simplification"],
      "build.review.fix.risks": ["debugging-and-error-recovery", "incremental-implementation"],
      notes: ["incremental-implementation", "code-simplification"],
      refactor: ["ponytail"],
      "refactor.fix.suite": ["ponytail", "debugging-and-error-recovery"],
      "refactor.health": ["ponytail", "debugging-and-error-recovery"],
      seam: ["incremental-implementation"],
      implement: ["test-driven-development", "incremental-implementation"],
      "implement.fix.suite": ["debugging-and-error-recovery"],
      "implement.health": ["debugging-and-error-recovery"],
    })
  })

  it("keys one refactor lens scope per refactorQualityReviews entry", () => {
    const custom = skills({ ...defaults, refactorQualityReviews: " my-lens ,, correctness" })
    expect(
      Object.keys(custom)
        .filter((k) => k.startsWith("refactor.build.quality."))
        .sort(),
    ).toEqual(["refactor.build.quality.correctness", "refactor.build.quality.my-lens"])
    const none = skills({ ...defaults, refactorQualityReviews: "" })
    expect(Object.keys(none).filter((k) => k.startsWith("refactor.build.quality."))).toEqual([])
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

  it("keys a hinted entry by its lens alone, with the lens's own skills", () => {
    const custom = skills({ ...defaults, qualityReviews: "my-lens=smart, correctness = base" })
    expect(custom["build.quality.my-lens"]).toEqual(["my-lens"])
    expect(custom["build.quality.correctness"]).toEqual(["code-review-and-quality"])
    expect(Object.keys(custom).some((k) => k.includes("="))).toBe(false)
  })
})
