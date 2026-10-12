Feature: starting over a pending hand-off refuses

  A review that ended with notes leaves `.gtd/REVIEW.md` and
  `.gtd/REVIEW.orig.md` for `gtd door fix`. Starting `review` or `feature` over a
  pending hand-off refuses before any step — the review gate never runs. `door
  fix` is the hand-off's consumer; it refuses only an orphan
  `.gtd/REVIEW.orig.md` (no `.gtd/REVIEW.md`).

  Background:
    Given a test project
    And the workflow gtd install scaffolds
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "chore: review notes" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
        new add function — rename it to sum
      """
    And a commit "chore: reviewer copy" that adds ".gtd/REVIEW.orig.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
        new add function
      """

  @inmem
  Scenario: review over a pending hand-off refuses and lands no step
    When I run gtd with args "--workflow review --var reviewBase=base"
    Then it fails
    And stderr contains ".gtd/REVIEW.orig.md is a pending hand-off"
    And the last commit subject is "chore: reviewer copy"

  @inmem
  Scenario: feature over a pending hand-off refuses and lands no step
    Given a file ".gtd/TODO.md" with:
      """
      sketch: add a greeting
      """
    When I run gtd land
    Then it fails
    And stderr contains ".gtd/REVIEW.orig.md is a pending hand-off"
    And the last commit subject is "chore: reviewer copy"

  @inmem
  Scenario: fix over a reviewer copy with no review refuses and lands no step
    Given the file ".gtd/REVIEW.md" is deleted
    And the working tree is committed with message:
      """
      chore: drop review
      """
    When I run gtd with args "door fix"
    Then it fails
    And stderr contains "has no .gtd/REVIEW.md"
    And the last commit subject is "chore: drop review"
