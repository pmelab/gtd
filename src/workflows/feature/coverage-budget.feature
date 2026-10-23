@inmem
Feature: the coverage judge sees the change's own tests first

  implement.coverage sends the judge the hunks the change made to test files,
  not whole files, and a hunk naming one of this slice's criterion IDs on a
  line the change added goes last, where a budget cut keeps it. A fixture's
  unchanged `[AC-1]` tags do not crowd the real test out.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_PROTOTYPEROUNDS" set to "0"
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAGMODE" set to "false"
    And an environment variable "GTD_JUDGEBUDGETBYTES" set to "400"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/fixtures.test.ts" with:
      """
      const report = `
        - [AC-1] first fixture line, padded to take up room in the evidence
        - [AC-1] second fixture line, padded to take up room in the evidence
        - [AC-2] third fixture line, padded to take up room in the evidence
        - [AC-1] fourth fixture line, padded to take up room in the evidence
        - [AC-2] fifth fixture line, padded to take up room in the evidence
        - [AC-1] sixth fixture line, padded to take up room in the evidence
      `
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

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: add is unchanged.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => expect(subtract(3, 1)).toBe(2))
      it("[AC-2] adds", () => expect(add(1, 1)).toBe(2))
      """
    And step "seam.check" changes nothing
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script

  Scenario: a fixture's unchanged criterion tags do not crowd the change's own test out of the budget
    Given step "seam.naive" writes "src/fixtures.test.ts" with:
      """
      const report = `
        - [AC-1] first fixture line, padded to take up room in the evidence
        - [AC-1] second fixture line, padded to take up room in the evidence
        - [AC-2] third fixture line, padded to take up room in the evidence
        - [AC-1] fourth fixture line, padded to take up room in the evidence
        - [AC-2] fifth fixture line, padded to take up room in the evidence
        - [AC-1] sixth fixture line, padded to take up room in the evidence
        ## Impact
      `
      """
    When the process is driven
    Then the process rests at "implement.coverage"
    And the output of gtd "judge" contains "[AC-1] subtracts"
    And the output of gtd "judge" contains "## Impact"
    And the output of gtd "judge" does not contain "first fixture line"
