import { describe, expect, it } from "vitest"
import { access } from "./access.js"
import { bundled as workflow } from "./index.js"

const { defaults } = workflow

const bundled = access(defaults)

describe("the bundled workflow's access export", () => {
  it("restricts writes on planning, review and lens scopes only", () => {
    expect(bundled).toEqual({
      design: { write: [] },
      architecture: { write: [".gtd/REQUIREMENTS.md"] },
      "architecture.decompose": { write: [".gtd/packages/**", ".gtd/ARCHITECTURE.md"] },
      "build.review": { write: [".gtd/REVIEW.md"] },
      "build.review.fix.nits": {},
      "build.review.fix.risks": {},
      "build.quality.correctness": { write: [] },
      "build.quality.owasp-security": { write: [] },
      "build.quality.ponytail-review": { write: [] },
      "build.quality.test-audit": { write: [] },
      "build.quality.conventions": { write: [] },
      "build.quality.spec-challenge": { write: [] },
    })
  })

  it("keys one lens scope per qualityReviews entry", () => {
    const custom = access({ ...defaults, qualityReviews: " my-lens ,, correctness" })
    expect(
      Object.keys(custom)
        .filter((k) => k.startsWith("build.quality."))
        .sort(),
    ).toEqual(["build.quality.correctness", "build.quality.my-lens"])
  })

  it("keys only scopes that run a turn (every key is a skills key)", () => {
    const known = Object.keys(workflow.skills(defaults))
    for (const key of Object.keys(bundled)) expect(known).toContain(key)
  })
})
