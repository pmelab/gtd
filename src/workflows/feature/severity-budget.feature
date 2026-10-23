@inmem
Feature: the review's ranking is batched to the judge's budget

  `build.review.ranking` puts as many chunks in one judgment as the budget's
  even share still holds whole; the rest go to the next. A chunk too big to
  fit even alone is cut, and a cut chunk is critical.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_PROTOTYPEROUNDS" set to "0"
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
    And an environment variable "GTD_FLAGMODE" set to "false"
    And an environment variable "GTD_JUDGEBUDGETBYTES" set to "150"
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

      - AC-1: subtract(a, b) returns a - b.
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
    And step "build.quality.correctness.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## AC-1 ignores floating point

      Should subtract round? The criterion does not say.
      """
    And judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"design","p":0.9}]
      """
    And step "build.quality.sorting" runs its script
    And step "build.quality.closing" runs its script
    And step "build.review.carrying" runs its script

  Scenario: a chunk the budget cuts is listed as critical, the others judged in batches of their own
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — returns the raw difference
      """
    And judge step "build.review.ranking", when its questions contain "C1.security", answers:
      """
      [{"id":"C1.security","answer":"no","p":0.9},{"id":"C1.reversibility","answer":"two-way","p":0.9},{"id":"C1.blastRadius","answer":"local","p":0.9},{"id":"C1.newConcept","answer":"no","p":0.9}]
      """
    And judge step "build.review.ranking", when its questions contain "C2.security", answers:
      """
      [{"id":"C2.security","answer":"no","p":0.9},{"id":"C2.reversibility","answer":"two-way","p":0.9},{"id":"C2.blastRadius","answer":"local","p":0.9},{"id":"C2.newConcept","answer":"no","p":0.9}]
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains:
      """
      ## AC-1 ignores floating point

      _critical: judge unsure_
      """
    And ".gtd/REVIEW.md" contains:
      """
      ## Subtract

      _could_
      """
    And the commit subjects end with:
      """
      gtd(agent): build.review.reviewing → build.review.ranking
      gtd(judge): build.review.ranking
      gtd(judge): build.review.ranking → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """
