@inmem
Feature: a rebuild stopped at its context limit is continued on the branch

  The rebuild's snapshot is its own commit: the continuation finds the work
  in the tree, and the health loop greens the whole build afterwards.
  `seamAllow` is empty here, so the naive pass's change to an existing test
  file is the judge's only stray and refactor-first rebuilds with no refactor.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_SEAMALLOW" set to ""
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_REFACTORQUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_RISK_TIER" set to "0"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "tests/calc.test.ts" with:
      """
      it("adds", () => {})
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

      ## Acceptance Criteria

      - AC-1: `subtract(5, 3)` returns 2.
      - AC-2: `multiply(2, 3)` returns 6.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.check" changes nothing

  Scenario: a rebuild stopped at its context limit lands its snapshot and is continued on the branch
    Given step "seam.naive" writes "src/ops.ts" with:
      """
      export const subtract = (a: number, b: number) => a - b
      export const multiply = (a: number, b: number) => a * b
      """
    And step "seam.naive" writes "tests/calc.test.ts" with:
      """
      it("adds", () => {})
      it("[AC-1] subtracts", () => {})
      it("[AC-2] multiplies", () => {})
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And step "implement.building" writes "tests/calc.test.ts" with:
      """
      it("adds", () => {})
      it("[AC-1] subtracts", () => {})
      """
    And step "implement.building" writes ".gtd/HANDOFF.md" with:
      """
      Rebuilt subtract behind the flag; multiply was next.
      """
    When the process is driven
    Then the process rests at "implement.continue.building"
    And the resting step's content contains "Still open: AC-2."
    And the resting step's content contains "Its work is already in the tree."
    And the resting step's content contains "Delete `.gtd/HANDOFF.md` once you are done"
    And "tests/calc.test.ts" contains "[AC-1] subtracts"

    Given step "implement.continue.building" writes "tests/calc.test.ts" with:
      """
      it("adds", () => {})
      it("[AC-1] subtracts", () => {})
      it("[AC-2] multiplies", () => {})
      """
    And step "implement.continue.building" deletes ".gtd/HANDOFF.md"
    When the process is driven
    Then the process rests at "implement.health.check"
    And the commit subjects end with:
      """
      gtd(agent): implement.building → implement.continue.building
      gtd(agent): implement.continue.building → implement.health.check
      """

