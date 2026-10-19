import { describe, expect, it } from "vitest"
import { access } from "./access.js"
import * as workflow from "../index.js"

const { defaults } = workflow

const bundled = access(defaults)

describe("the bundled workflow's access export", () => {
  it("restricts writes on planning, review and lens scopes only", () => {
    expect(bundled).toEqual({
      design: { write: [] },
      "build.review": { write: [".gtd/REVIEW.md"] },
      "build.review.defer": { write: [".gtd/TODO.md"] },
      "build.review.fix.nits": {},
      "build.review.fix.risks": {},
      "build.quality.correctness": { write: [] },
      "build.quality.owasp-security": { write: [] },
      "build.quality.ponytail-review": { write: [] },
      "build.quality.test-audit": { write: [] },
      "build.quality.conventions": { write: [] },
      "build.quality.spec-challenge": { write: [] },
      "refactor.build.review": { write: [".gtd/REVIEW.md"] },
      "refactor.build.review.defer": { write: [".gtd/TODO.md"] },
      "refactor.build.quality.correctness": { write: [] },
      "refactor.build.quality.ponytail-review": { write: [] },
      "refactor.build.quality.conventions": { write: [] },
    })
  })

  it("leaves the refactor review's fix scopes to the refactor's own scope option", () => {
    expect(bundled).not.toHaveProperty(["refactor.build.review.fix.nits"])
    expect(bundled).not.toHaveProperty(["refactor.build.review.fix.risks"])
    expect(bundled["refactor.build.review"]).toEqual({ write: [".gtd/REVIEW.md"] })
    expect(bundled["refactor.build.review.defer"]).toEqual({ write: [".gtd/TODO.md"] })
  })

  it("keys one lens scope per qualityReviews entry", () => {
    const custom = access({ ...defaults, qualityReviews: " my-lens ,, correctness" })
    expect(
      Object.keys(custom)
        .filter((k) => k.startsWith("build.quality."))
        .sort(),
    ).toEqual(["build.quality.correctness", "build.quality.my-lens"])
  })

  it("keys one refactor lens scope per refactorQualityReviews entry beside the refactor review's own", () => {
    const custom = access({ ...defaults, refactorQualityReviews: " my-lens ,, correctness" })
    expect(
      Object.keys(custom)
        .filter((k) => k.startsWith("refactor."))
        .sort(),
    ).toEqual([
      "refactor.build.quality.correctness",
      "refactor.build.quality.my-lens",
      "refactor.build.review",
      "refactor.build.review.defer",
    ])
  })

  it("keys only turn or script scopes", () => {
    // `build.review.defer` is a script scope: no turn, so no skills entry.
    const known = [
      ...Object.keys(workflow.skills(defaults)),
      "build.review.defer",
      "refactor.build.review.defer",
    ]
    for (const key of Object.keys(bundled)) expect(known).toContain(key)
  })
})
