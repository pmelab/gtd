@inmem
Feature: the final review lists what matters most first

  Before the review rests, the judge rates every chunk the reviewer wrote — a
  walkthrough chunk or a carried quality finding — on the same four questions
  as a human's note (`build.review.ranking`): critical (security, or a one-way
  door), should (a contract, or a new concept), could. The review lists them
  in that order, security before one-way doors, each led by its tier and
  reason. A chunk the judge cannot rate is critical, so it is shown first.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_PROTOTYPEROUNDS" set to "0"
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
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

  Scenario: security and one-way doors come first, a carried finding sorted among the rest
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      The new export.

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## Session token

      - [ ] ./src/calc.ts#1-1 — reads the caller's token

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — returns the raw difference

      ## Saved format

      - [ ] ./src/calc.ts#1-2 — what callers persist
      """
    And judge step "build.review.ranking" answers:
      """
      [{"id":"C1.security","answer":"no","p":0.9},{"id":"C1.reversibility","answer":"two-way","p":0.9},{"id":"C1.blastRadius","answer":"local","p":0.9},{"id":"C1.newConcept","answer":"no","p":0.9},{"id":"C2.security","answer":"yes","p":0.9},{"id":"C2.reversibility","answer":"two-way","p":0.9},{"id":"C2.blastRadius","answer":"module","p":0.9},{"id":"C2.newConcept","answer":"no","p":0.9},{"id":"C3.security","answer":"no","p":0.9},{"id":"C3.reversibility","answer":"two-way","p":0.9},{"id":"C3.blastRadius","answer":"contract","p":0.9},{"id":"C3.newConcept","answer":"no","p":0.9},{"id":"C4.security","answer":"no","p":0.9},{"id":"C4.reversibility","answer":"one-way","p":0.9},{"id":"C4.blastRadius","answer":"contract","p":0.9},{"id":"C4.newConcept","answer":"no","p":0.9}]
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains:
      """
      ## Session token

      _critical: security_

      - [ ] ./src/calc.ts#1-1 — reads the caller's token

      ## Saved format

      _critical: one-way door_

      - [ ] ./src/calc.ts#1-2 — what callers persist

      ## AC-1 ignores floating point

      _should: contract_

      Should subtract round? The criterion does not say.
      """
    And ".gtd/REVIEW.md" contains:
      """
      - [ ] _your answer_

      ## Subtract

      _could_

      The new export.
      """
    And the commit "gtd(judge): build.review.ranking → build.review.carrying" has a body containing "Gtd-Judge:"
    And the commit subjects end with:
      """
      gtd(agent): build.review.reviewing → build.review.ranking
      gtd(judge): build.review.ranking → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: a chunk the judge is unsure about is listed as critical
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      The new export.

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## Session token

      - [ ] ./src/calc.ts#1-1 — reads the caller's token

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — returns the raw difference

      ## Saved format

      - [ ] ./src/calc.ts#1-2 — what callers persist
      """
    And judge step "build.review.ranking" answers:
      """
      [{"id":"C1.security","answer":"no","p":0.9},{"id":"C1.reversibility","answer":"two-way","p":0.9},{"id":"C1.blastRadius","answer":"local","p":0.9},{"id":"C1.newConcept","answer":"no","p":0.9},{"id":"C2.security","answer":"no","p":0.4},{"id":"C2.reversibility","answer":"two-way","p":0.9},{"id":"C2.blastRadius","answer":"local","p":0.9},{"id":"C2.newConcept","answer":"no","p":0.9},{"id":"C3.security","answer":"no","p":0.9},{"id":"C3.reversibility","answer":"two-way","p":0.9},{"id":"C3.blastRadius","answer":"contract","p":0.9},{"id":"C3.newConcept","answer":"no","p":0.9},{"id":"C4.security","answer":"no","p":0.9},{"id":"C4.reversibility","answer":"two-way","p":0.9},{"id":"C4.blastRadius","answer":"local","p":0.9},{"id":"C4.newConcept","answer":"yes","p":0.9}]
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Session token

      _critical: judge unsure_
      """
    And ".gtd/REVIEW.md" contains:
      """
      ## AC-1 ignores floating point

      _should: contract_
      """
    And ".gtd/REVIEW.md" contains:
      """
      ## Saved format

      _should: new concept_
      """
    And ".gtd/REVIEW.md" contains:
      """
      ## Subtract

      _could_
      """
