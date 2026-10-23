@inmem
Feature: past its continuation cap a phase rests for a person

  With `continuations` at 1, a naive pass stopped at its context limit gets
  one continuation; when that one stops too, `seam.oversized` asks a person,
  and landing there grants a fresh round.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_CONTINUATIONS" set to "1"
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_REFACTORQUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_RISK_TIER" set to "0"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"
    And a file "TODO.md" with:
      """
      # Add subtract and multiply
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: `subtract(5, 3)` returns 2.
      - AC-2: `multiply(2, 3)` returns 6.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.check" changes nothing

  Scenario: past the continuation cap the naive pass rests for a person, and landing there grants a new round
    Given step "seam.naive" writes ".gtd/HANDOFF.md" with:
      """
      Roughed out subtract.
      """
    And step "seam.continue.naive" writes "tests/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And step "seam.continue.naive" writes ".gtd/HANDOFF.md" with:
      """
      Subtract is tested; multiply was next.
      """
    When the process is driven
    Then the process rests at "seam.oversized"
    And the resting step's content contains "1 continuation ran and the last still stopped at its context limit"
    And the resting step's content contains "still open: AC-2"

    When gtd lands
    Then the process rests at "seam.continue.naive"
    And the resting step's content contains "Still open: AC-2."
    And the commit subjects end with:
      """
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.continue.naive
      gtd(agent): seam.continue.naive → seam.oversized
      gtd(human): seam.oversized → seam.continue.naive
      """

