@inmem
Feature: each finding the reviewer is handed names the lens that wrote it

  Lenses append to `.gtd/QUALITY.md` in turn, so a finding belongs to the lens
  whose turn added it — even when two lenses give findings the same title,
  which the review then tells apart by a numbered suffix.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness,tests"
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

      ## sum is untested

      From correctness.
      """
    And step "build.quality.tests.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## sum is untested

      From correctness.

      ## sum is untested

      From tests.
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

  Scenario: two lenses' findings with one title each name their own lens
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"design","p":0.9},{"id":"Q2","answer":"design","p":0.9}]
      """
    When gtd opens door "fix"
    And the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains:
      """
      ## sum is untested

      _From lens correctness._

      From correctness.

      ## sum is untested (2)

      _From lens tests._

      From tests.
      """
