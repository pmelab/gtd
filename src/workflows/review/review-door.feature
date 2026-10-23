@inmem
Feature: the review door fixes its notes in the same process

  `gtd door review` runs the feature's review over everything since its base:
  the triaged quality lap and its finding gate, then a reviewer's walkthrough
  of the change with the lap's summary, where the human's notes are fixed in
  place under the health loop before the review comes back. A sign-off ends
  the process; nothing is left for `fix`.

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
    And judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"design","p":0.9}]
      """
    And step "build.quality.gating" runs its script
    And step "build.quality.gate" changes nothing
    And step "build.quality.closing" runs its script
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Calculator

      - [ ] ./src/calc.ts#1-1 — add(a, b)
      """
    And step "build.review.carrying" runs its script
    And step "build.review.closing" runs its script

  Scenario: the review is a walkthrough, its summary listing what the finding gate dropped
    When gtd opens door "review" with "HEAD~1"
    And the process is driven
    Then the process rests at "build.review.await-review"
    And the commit subjects end with:
      """
      gtd(human): review-gate.check
      gtd(check): review-gate.check → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.quality.triage
      gtd(judge): build.quality.triage → build.quality.gating
      gtd(check): build.quality.gating → build.quality.gate
      gtd(human): build.quality.gate → build.quality.closing
      gtd(check): build.quality.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """
    And ".gtd/REVIEW.md" contains:
      """
      ## Calculator

      - [ ] ./src/calc.ts#1-1 — add(a, b)

      ## Quality lap
      """
    And ".gtd/REVIEW.md" contains:
      """
      Dropped at the finding gate:

      - add has no test (lens correctness)
      """
    And ".gtd/REVIEW.md" does not contain "Tick exactly one:"
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/REVIEW.md" does not exist
    And ".gtd/REVIEW.orig.md" does not exist

  Scenario: a nit note is fixed in place, then reviewed again
    Given judge step "build.review.triage" answers:
      """
      [{"id":"note-1","answer":"nit","p":0.9}]
      """
    And step "build.review.fix.nits.fixing" writes "src/calc.test.ts" with:
      """
      it("adds", () => {})
      """
    When gtd opens door "review" with "HEAD~1"
    And the process is driven
    And the text "— add(a, b)" in ".gtd/REVIEW.md" is replaced with "— add(a, b) — add a test for it"
    And gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And the commit subjects end with:
      """
      gtd(human): build.review.await-review → build.review.triage
      gtd(judge): build.review.triage → build.review.fix.nits.fixing
      gtd(agent): build.review.fix.nits.fixing → build.health.check
      gtd(check): build.health.check → build.review.closing
      gtd(check): build.review.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """
    And "src/calc.test.ts" contains "adds"

  Scenario: a note asking for a change is fixed in place, then reviewed again
    Given judge step "build.review.triage" answers:
      """
      [{"id":"note-1","answer":"edit","p":0.9}]
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
    And the text "— add(a, b)" in ".gtd/REVIEW.md" is replaced with "— add(a, b) — test negatives too"
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
      gtd(judge): build.quality.triage → build.quality.gating
      gtd(check): build.quality.gating → build.quality.gate
      gtd(human): build.quality.gate → build.quality.closing
      gtd(check): build.quality.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """
    And ".gtd/REQUIREMENTS.md" does not exist
    And "src/calc.test.ts" contains "adds negatives"
    And ".gtd/REVIEW.md" does not contain "test negatives too"

  Scenario: a leftover requirements file is refused before any step
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements
      """
    And the working tree is committed as "chore: leftover requirements"
    Then opening door "review" is refused with ".gtd/REQUIREMENTS.md is left over"

  Scenario: a note added with its own boxes is fixed as ticked, never judged
    Given step "build.review.fix.nits.fixing" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number): number => a + b
      """
    When gtd opens door "review" with "HEAD~1"
    And the process is driven
    And ".gtd/REVIEW.md" gets appended:
      """
      ## src/calc.ts:1 (thread PRRT_1)

      > Annotate the return type.

      Tick exactly one:

      - [x] fix as suggested
      - [ ] won't fix
      - [ ] _your answer_
      """
    And gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And the commit subjects end with:
      """
      gtd(human): build.review.await-review → build.review.fix.nits.fixing
      gtd(agent): build.review.fix.nits.fixing → build.health.check
      gtd(check): build.health.check → build.review.closing
      gtd(check): build.review.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """
    And "src/calc.ts" contains "): number =>"
