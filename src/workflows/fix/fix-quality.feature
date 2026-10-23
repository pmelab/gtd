@inmem
Feature: fix's quality lap is triaged, and its leftovers go to the hand-off review

  A judge sorts the lap's findings: mechanical ones are fixed for up to three
  turns, noise is dropped, and design ones — with whatever the fix turns left —
  are added to the reviewer's `.gtd/REVIEW.md` by gtd, never to a person's
  gate before the review. With no requirements to check against, the
  `criteria-coverage` lens runs no turn.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to "criteria-coverage, correctness"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"
    And a file ".gtd/REVIEW.orig.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        new add function
      """
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        new add function — rename it to sum
      """
    And the working tree is committed as "chore: hand off a review"
    And step "notes.fixing" writes "src/calc.ts" with:
      """
      export const sum = (a: number, b: number) => a + b
      """
    And step "notes.closing" runs its script
    And step "build.health.check" changes nothing
    And step "build.quality.correctness.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## sum has no negative test

      Add a test summing negative numbers.

      ## sum should be named plus

      The glossary says plus.
      """
    And step "build.quality.sorting" runs its script
    And step "build.quality.closing" runs its script
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        renamed to sum
      """
    And step "build.review.carrying" runs its script

  Scenario: a design finding and one the fix cap left reach the reviewer, never an escalation
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9},{"id":"Q2","answer":"design","p":0.9}]
      """
    And step "build.fix.quality.fixing" changes nothing
    When gtd opens door "fix"
    And the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/QUALITY.md" does not exist
    And no commit body contains "build.health.describe"
    And no commit body contains "build.quality.criteria-coverage"
    And ".gtd/REVIEW.md" contains:
      """
      ## sum has no negative test

      _From lens correctness._

      _The fixer left this unresolved._
      """
    And ".gtd/REVIEW.md" contains:
      """
      ## sum should be named plus

      _From lens correctness._

      The glossary says plus.
      """
    And the commit subjects end with:
      """
      gtd(agent): build.quality.correctness.reviewing → build.quality.triage
      gtd(judge): build.quality.triage → build.quality.sorting
      gtd(check): build.quality.sorting → build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing → build.health.check
      gtd(check): build.health.check → build.quality.closing
      gtd(check): build.quality.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: a fixed finding and a noise one are listed in the review
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9},{"id":"Q2","answer":"noise","p":0.9}]
      """
    And step "build.fix.quality.fixing" writes "src/calc.test.ts" with:
      """
      it("sums negative numbers", () => {})
      """
    And step "build.fix.quality.fixing" deletes ".gtd/QUALITY.md"
    When gtd opens door "fix"
    And the process is driven
    Then the process rests at "build.review.await-review"
    And no commit body contains "build.quality.closing"
    And ".gtd/REVIEW.md" contains "## Fixed automatically"
    And ".gtd/REVIEW.md" contains "- sum has no negative test ("
    And ".gtd/REVIEW.md" contains the short hash of the commit "gtd(agent): build.fix.quality.fixing → build.health.check"
    And ".gtd/REVIEW.md" contains "- sum should be named plus (p=0.9, lens correctness)"
