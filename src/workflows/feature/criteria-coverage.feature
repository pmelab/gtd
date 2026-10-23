@inmem
Feature: the criteria-coverage lens checks the change's tests against its criteria

  The `criteria-coverage` quality lens gets the requirements the change was
  built to, quoted in its prompt, and writes one finding per acceptance
  criterion no test exercises. Its findings are triaged like any other lens's.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_PROTOTYPEROUNDS" set to "0"
    And an environment variable "GTD_QUALITYREVIEWS" set to "criteria-coverage"
    And an environment variable "GTD_FLAGMODE" set to "false"
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

      ## Impact

      - the calculator module

      ## Acceptance Criteria

      - AC-1: `subtract(5, 3)` returns 2.
      - AC-2: `subtract(1, 3)` returns -2.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("subtracts", () => expect(subtract(5, 3)).toBe(2))
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

  Scenario: the lens gets the closed requirements and its finding per uncovered criterion is fixed
    When the process is driven
    Then the process rests at "build.quality.criteria-coverage.reviewing"
    And ".gtd/REQUIREMENTS.md" does not exist
    And the resting step's content contains "  > - AC-1: `subtract(5, 3)` returns 2."
    And the resting step's content contains "  > - AC-2: `subtract(1, 3)` returns -2."
    And the resting step's content contains "one finding per criterion no test exercises"

    Given step "build.quality.criteria-coverage.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## AC-2 is not tested

      No test subtracts a larger number.
      """
    And judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9}]
      """
    And step "build.fix.quality.fixing" writes "src/calc.test.ts" with:
      """
      it("subtracts", () => expect(subtract(5, 3)).toBe(2))
      it("subtracts a larger number", () => expect(subtract(1, 3)).toBe(-2))
      """
    And step "build.fix.quality.fixing" deletes ".gtd/QUALITY.md"
    And step "build.health.check" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)
      """
    And judge step "build.review.ranking" answers:
      """
      []
      """
    And step "build.review.carrying" runs its script
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains "- AC-2 is not tested ("
    And the commit subjects end with:
      """
      gtd(check): implement.closing → build.quality.criteria-coverage.reviewing
      gtd(agent): build.quality.criteria-coverage.reviewing → build.quality.triage
      gtd(judge): build.quality.triage → build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing → build.health.check
      gtd(check): build.health.check → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.ranking
      gtd(judge): build.review.ranking → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """
