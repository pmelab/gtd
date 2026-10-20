@inmem
Feature: the review door fixes its notes in the same process

  `gtd door review` runs the feature's review over everything since its base:
  the triaged quality lap writes `.gtd/REVIEW.md`, the human answers each note,
  and what they ask for is fixed in place under the health loop before the
  review comes back. A sign-off ends the process; nothing is left for `fix`.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"
    And step "review-gate.check" changes nothing
    And step "build.health.check" changes nothing
    And step "build.quality.correctness.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## add has no test

      Add a test for add.
      """
    And step "build.quality.sorting" runs its script
    And judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"design","p":0.9}]
      """
    And step "build.review.composing" runs its script
    And step "build.review.closing" runs its script

  Scenario: the review is composed from the lap's notes, with answer boxes
    When gtd opens door "review" with "HEAD~1"
    And the process is driven
    Then the process rests at "build.review.await-review"
    And the commit subjects end with:
      """
      gtd(human): review-gate.check
      gtd(check): review-gate.check → build.health.check
      gtd(check): build.health.check → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.quality.triage
      gtd(judge): build.quality.triage → build.quality.sorting
      gtd(check): build.quality.sorting → build.review.composing
      gtd(check): build.review.composing → build.review.await-review
      """
    And ".gtd/REVIEW.md" contains:
      """
      ## add has no test

      Add a test for add.

      Tick exactly one:

      - [ ] fix as suggested
      - [ ] won't fix
      - [ ] _your answer_
      """

  Scenario: a won't-fix signs off, and no review is left for fix
    When gtd opens door "review" with "HEAD~1"
    And the process is driven
    And the text "- [ ] won't fix" in ".gtd/REVIEW.md" is replaced with "- [x] won't fix"
    And gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/REVIEW.md" does not exist
    And ".gtd/REVIEW.orig.md" does not exist

  Scenario: a note ticked fix as suggested is fixed in place, then reviewed again
    Given step "build.review.fix.nits.fixing" writes "src/calc.test.ts" with:
      """
      it("adds", () => {})
      """
    When gtd opens door "review" with "HEAD~1"
    And the process is driven
    And the text "- [ ] fix as suggested" in ".gtd/REVIEW.md" is replaced with "- [x] fix as suggested"
    And gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And the commit subjects end with:
      """
      gtd(human): build.review.await-review → build.review.fix.nits.fixing
      gtd(agent): build.review.fix.nits.fixing → build.health.check
      gtd(check): build.health.check → build.review.closing
      gtd(check): build.review.closing → build.review.composing
      gtd(check): build.review.composing → build.review.await-review
      """
    And ".gtd/REVIEW.md" contains "## Fixed from your notes"
    And "src/calc.test.ts" contains "adds"
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/REVIEW.md" does not exist
    And ".gtd/REVIEW.orig.md" does not exist

  Scenario: an own answer asking for a change is fixed in place, then reviewed again
    Given judge step "build.review.triage" answers:
      """
      [{"id":"answer-1","answer":"edit","p":0.9}]
      """
    And step "build.review.collecting" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Test add with negatives

      add(-1, -2) returns -3.
      """
    And step "feedback.fixing" is prompted with ".gtd/REQUIREMENTS.md"
    And step "feedback.fixing" writes "src/calc.test.ts" with:
      """
      it("adds negatives", () => {})
      """
    And step "re-unwind" runs its script
    And step "feedback.closing" runs its script
    When gtd opens door "review" with "HEAD~1"
    And the process is driven
    And the text "- [ ] _your answer_" in ".gtd/REVIEW.md" is replaced with "- [x] test negatives too"
    And gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And the commit subjects end with:
      """
      gtd(human): build.review.await-review → build.review.triage
      gtd(judge): build.review.triage → build.review.closing
      gtd(check): build.review.closing → build.review.collecting
      gtd(agent): build.review.collecting → re-unwind
      gtd(check): re-unwind → feedback.fixing
      gtd(agent): feedback.fixing → feedback.closing
      gtd(check): feedback.closing → build.health.check
      gtd(check): build.health.check → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.quality.triage
      gtd(judge): build.quality.triage → build.quality.sorting
      gtd(check): build.quality.sorting → build.review.composing
      gtd(check): build.review.composing → build.review.await-review
      """
    And ".gtd/REQUIREMENTS.md" does not exist
    And "src/calc.test.ts" contains "adds negatives"
    And ".gtd/REVIEW.md" does not contain "test negatives too"
