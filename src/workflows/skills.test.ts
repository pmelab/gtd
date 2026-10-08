import { describe, expect, it } from "vitest"
import { skills } from "./skills.js"

// Pins every bundled step's own declared list, keyed by its full name. This
// file alone only catches a LOCAL-name rename (the list literally changes);
// it cannot catch a SCOPE rename (e.g. `scope("architecture")` renamed to
// `scope("design.architecture")`), because it never runs the real flow — it
// compares the map against itself. Every one of the fifteen keys has its
// own e2e grounding closing that gap instead — each runs the actual scoped
// name through replay, so a scope rename desyncs a preamble assertion there,
// not just silently drops a step's skills (see AGENTS.md's "workflow is
// code" rule: a step's full name is public API):
//   - design.triage, architecture.author, architecture.decompose,
//     packages.item.building — default-workflow.feature's main scenario
//   - packages.item.fix-suite, packages.item.health.describe — the
//     "escalation loop ... under packages.item" scenario
//   - build.fix — state-skills.feature
//   - build.health.describe — the "repeated check failures escalate"
//     scenario
//   - build.quality.reviewing — per-step-skills.feature
//   - build.fix-quality — quality-review-lap.feature
//   - build.review.reviewing, build.review.collecting —
//     default-workflow.feature's review-loop scenarios
//   - build.review.answer-review-questions, build.review.fix-nits — NOT yet
//     e2e-grounded; only steps.test.ts's preamble checks, which use local names
describe("the bundled workflow's skills map", () => {
  it("declares exactly the fifteen bundled agent steps, by full name", () => {
    expect(Object.keys(skills).sort()).toEqual(
      [
        "design.triage",
        "architecture.author",
        "architecture.decompose",
        "packages.item.building",
        "packages.item.fix-suite",
        "packages.item.health.describe",
        "build.fix",
        "build.health.describe",
        "build.quality.reviewing",
        "build.fix-quality",
        "build.review.reviewing",
        "build.review.answer-review-questions",
        "build.review.fix-nits",
        "build.review.fix-risks",
        "build.review.collecting",
      ].sort(),
    )
  })

  it("packages.item.health.describe and build.health.describe are both present, with the same list — the shared escalation loop resolves under both scopes", () => {
    expect(skills["packages.item.health.describe"]).toEqual(skills["build.health.describe"])
    expect(skills["packages.item.health.describe"]).toEqual(["debugging-and-error-recovery"])
  })

  it("pins each step's own declared list", () => {
    expect(skills["design.triage"]).toEqual([
      "spec-driven-development",
      "planning-and-task-breakdown",
    ])
    expect(skills["architecture.author"]).toEqual([
      "api-and-interface-design",
      "documentation-and-adrs",
      "ponytail",
    ])
    expect(skills["architecture.decompose"]).toEqual([
      "incremental-implementation",
      "planning-and-task-breakdown",
    ])
    expect(skills["packages.item.building"]).toEqual([
      "test-driven-development",
      "incremental-implementation",
    ])
    expect(skills["packages.item.fix-suite"]).toEqual(["debugging-and-error-recovery"])
    expect(skills["build.fix"]).toEqual(["debugging-and-error-recovery"])
    expect(skills["build.fix-quality"]).toEqual([
      "incremental-implementation",
      "code-simplification",
    ])
    expect(skills["build.review.reviewing"]).toEqual(["code-review-and-quality"])
    expect(skills["build.review.collecting"]).toEqual(["code-review-and-quality"])
    expect(skills["build.quality.reviewing"]).toEqual([])
  })
})
