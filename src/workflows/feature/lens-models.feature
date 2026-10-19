@inmem
Feature: each quality lens runs on its own model hint

  A `qualityReviews` entry may carry a model hint, `<lens>=<model>`. A lens
  without one runs on the planner model (`smart`), except `conventions`,
  `ponytail-review` and `test-audit`, which run on the coder model (`base`).

  Background:
    Given a gtd config with:
      """
      import { feature } from "@pmelab/gtd/workflows/feature"
      export { summary, steering, skills, access } from "@pmelab/gtd/workflows/feature"
      export default feature({
        flagMode: false,
        qualityReviews: "correctness, conventions, test-audit=opus",
      })
      """
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"
    And a file "TODO.md" with:
      """
      # Add subtract

      subtract(a, b) returns the difference.
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: `subtract(a, b)` returns `a - b`.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "seam.check" changes nothing
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """

  Scenario: a hinted lens runs on its hint, every other lens on its default
    When the process is driven
    Then the process rests at "build.quality.correctness.reviewing"
    And the output of gtd "next --json" contains "\"model\":\"smart\""
    Given step "build.quality.correctness.reviewing" changes nothing
    When the process is driven
    Then the process rests at "build.quality.conventions.reviewing"
    And the output of gtd "next --json" contains "\"model\":\"base\""
    Given step "build.quality.conventions.reviewing" changes nothing
    When the process is driven
    Then the process rests at "build.quality.test-audit.reviewing"
    And the output of gtd "next --json" contains "\"model\":\"opus\""
    And the resting step's content contains "test-audit"
