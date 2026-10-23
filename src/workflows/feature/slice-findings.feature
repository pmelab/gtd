@inmem
Feature: every slice's quality lap is triaged, and its leftovers wait for the review

  A judge sorts each slice's findings like the last slice's (see
  `lens-review.feature`): mechanical ones are fixed, noise is dropped, design
  ones are never sent to the fixer. Nothing between slices asks a person
  anything — what a lap leaves is carried to the review after the last slice,
  each finding naming its slice and lens.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_PROTOTYPEROUNDS" set to "0"
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
    And an environment variable "GTD_FLAGMODE" set to "false"
    And an environment variable "GTD_SLICEMAXCRITERIA" set to "1"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"
    And a file "TODO.md" with:
      """
      # More arithmetic

      subtract and multiply.
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: multiply(a, b) returns a * b.
      """
    And step "design.gate.answer" changes nothing
    And step "design.slicing" writes ".gtd/SLICES.md" with:
      """
      # Slices

      ## Subtract

      - AC-1

      ## Multiply

      - AC-2
      """
    And step "seam.naive", when prompted with "This slice builds AC-1 only", writes "src/sub.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And step "seam.naive", when prompted with "This slice builds AC-2 only", writes "src/mul.test.ts" with:
      """
      it("[AC-2] multiplies", () => {})
      """
    And step "seam.check" changes nothing
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And judge step "implement.coverage", when its questions contain "AC-1", answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    And judge step "implement.coverage", when its questions contain "AC-2", answers:
      """
      [{"id":"AC-2","answer":"yes","p":0.9}]
      """
    And step "build.quality.sorting" runs its script
    And step "build.quality.closing" runs its script
    And step "build.health.check" changes nothing
    And step "build.review.carrying" runs its script
    And judge step "build.review.ranking" answers:
      """
      []
      """

  Scenario: a finding questioning a criterion reaches the final review, never the fixer
    Given step "build.quality.correctness.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## AC-1 ignores floating point

      Should subtract round? The criterion does not say.
      """
    And judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"design","p":0.9}]
      """
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract and multiply

      - [ ] ./src/sub.test.ts#1-1 — subtract
      - [ ] ./src/mul.test.ts#1-1 — multiply

      ## AC-1 ignores floating point

      - [ ] ./src/sub.test.ts#1-1 — where it applies

      ## AC-1 ignores floating point (2)

      - [ ] ./src/sub.test.ts#1-1 — where it applies
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And no commit body contains "build.fix.quality.fixing"
    And ".gtd/QUALITY.md" does not exist
    And ".gtd/REVIEW.md" contains:
      """
      ### AC-1 ignores floating point

      _critical: judge unsure_

      _From slice 1, lens correctness._

      Should subtract round? The criterion does not say.
      """
    And ".gtd/REVIEW.md" contains:
      """
      ### AC-1 ignores floating point (2)

      _critical: judge unsure_

      _From slice 2, lens correctness._
      """
    And the commit subjects end with:
      """
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.quality.triage
      gtd(judge): build.quality.triage → build.quality.sorting
      gtd(check): build.quality.sorting → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.quality.triage
      gtd(judge): build.quality.triage → build.quality.sorting
      gtd(check): build.quality.sorting → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.ranking
      gtd(judge): build.review.ranking → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: a mechanical finding the fix cap leaves in an early slice is carried, never escalated
    Given step "build.quality.correctness.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## subtract has no negative test

      Add a test subtracting a larger number.
      """
    And judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9}]
      """
    And step "build.fix.quality.fixing" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract and multiply

      - [ ] ./src/sub.test.ts#1-1 — subtract
      - [ ] ./src/mul.test.ts#1-1 — multiply

      ## subtract has no negative test

      - [ ] ./src/sub.test.ts#1-1 — where it applies

      ## subtract has no negative test (2)

      - [ ] ./src/sub.test.ts#1-1 — where it applies
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And no commit body contains "build.health.describe"
    And ".gtd/REVIEW.md" contains:
      """
      ### subtract has no negative test

      _critical: judge unsure_

      _From slice 1, lens correctness._

      _The fixer left this unresolved._
      """
    And the commit subjects end with:
      """
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.quality.triage
      gtd(judge): build.quality.triage → build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing → build.health.check
      gtd(check): build.health.check → build.quality.closing
      gtd(check): build.quality.closing → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.quality.triage
      gtd(judge): build.quality.triage → build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing → build.health.check
      gtd(check): build.health.check → build.quality.closing
      gtd(check): build.quality.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.ranking
      gtd(judge): build.review.ranking → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: the final review lists every slice's fixes with their commits
    Given step "build.quality.correctness.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## subtract has no negative test

      Add a test subtracting a larger number.
      """
    And judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9}]
      """
    And step "build.fix.quality.fixing" writes "src/edge.test.ts" with:
      """
      it("subtracts a larger number", () => {})
      """
    And step "build.fix.quality.fixing" deletes ".gtd/QUALITY.md"
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract and multiply

      - [ ] ./src/sub.test.ts#1-1 — subtract
      - [ ] ./src/mul.test.ts#1-1 — multiply
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains ", slice 1, lens correctness)"
    And ".gtd/REVIEW.md" contains ", slice 2, lens correctness)"
    And ".gtd/REVIEW.md" contains the short hash of the commit "gtd(agent): build.fix.quality.fixing → build.health.check"
    And no commit body contains "build.quality.closing"
