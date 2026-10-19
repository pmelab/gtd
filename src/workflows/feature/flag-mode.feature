@inmem
Feature: flag mode off lands the naive pass with no release flag, seam judge or refactor

  `flagMode` is a factory option of the shipped workflows, on by default. Off,
  the project ships without feature flags: no seam judge and no refactor run,
  and the naive pass itself lands, straight through the health loop and the
  quality lap.

  Background:
    Given a gtd config with:
      """
      import { feature } from "@pmelab/gtd/workflows/feature"
      export { summary, steering, skills, access } from "@pmelab/gtd/workflows/feature"
      export default feature({ flagMode: false })
      """
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
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

      ## Concerns

      ### Subtract

      - `subtract(a, b)` returns `a - b`.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And step "design.gate.answer" changes nothing

  Scenario: flag mode off lands the naive pass unjudged, and asks for no flag
    When the process is driven
    Then the process rests at "seam.naive"
    And the resting step's content contains "the quickest way that works"
    And the resting step's content does not contain "release flag"
    Given step "seam.naive" writes "src/calc.test.ts" with:
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
    And step "build.quality.correctness.reviewing" changes nothing
    When the process is driven
    Then the process rests at "idle"
    And "src/calc.ts" contains "subtract"
    And "src/calc.test.ts" contains "[AC-1] subtracts"
    And the commit subjects end with:
      """
      chore: initial commit
      feat: add calculator
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → idle
      """
