@inmem
Feature: a continuation stays inside its coarse slice

  A naive pass of one coarse slice that stops at its context limit is
  continued with that slice's criteria still open, never another slice's.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAGMODE" set to "false"
    And an environment variable "GTD_SLICEMAXCRITERIA" set to "2"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"
    And a file "TODO.md" with:
      """
      # More arithmetic

      subtract, multiply and divide.
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "design.gate.answer" changes nothing
    And step "seam.check" changes nothing

  Scenario: the first slice's continuation is told only that slice's open criterion
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: multiply(a, b) returns a * b.
      - AC-3: divide(a, b) returns a / b.
      """
    And step "design.slicing" writes ".gtd/SLICES.md" with:
      """
      # Slices

      ## Subtract and divide

      - AC-1
      - AC-3

      ## Multiply

      - AC-2
      """
    And step "seam.naive" writes "src/sub.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And step "seam.naive" writes ".gtd/HANDOFF.md" with:
      """
      Subtract is tested; divide was next.
      """
    When the process is driven
    Then the process rests at "seam.continue.naive"
    And the resting step's content contains "This slice builds AC-1, AC-3 only"
    And the resting step's content contains "Still open: AC-3."
    And the resting step's content does not contain "AC-2"
