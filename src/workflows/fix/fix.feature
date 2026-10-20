Feature: fix fixes the notes a hand-off leaves it

  A hand-off is `.gtd/REVIEW.md` with the human's notes beside the reviewer's
  own `.gtd/REVIEW.orig.md`; `gtd door fix` picks both up.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"

  Scenario: a handed-off note is fixed, and both review files are removed
    Given a file ".gtd/REVIEW.orig.md" with:
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
    And step "build.health.check" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        new add function
      """
    And step "notes.fixing" writes "src/calc.ts" with:
      """
      export const sum = (a: number, b: number) => a + b
      """
    And step "notes.closing" runs its script
    When gtd opens door "fix"
    Then the resting step's content contains "rename it to sum"
    # The fix goes to its own review, which the scripted reviewer writes afresh.
    When the process is driven
    Then the process rests at "build.review.await-review"
    And the commit subjects end with:
      """
      gtd(human): notes.fixing
      gtd(agent): notes.fixing → notes.closing
      gtd(check): notes.closing → build.health.check
      gtd(check): build.health.check → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.await-review
      """
    And ".gtd/REVIEW.orig.md" does not exist
    And ".gtd/REVIEW.md" contains "new add function"
    And "src/calc.ts" contains "sum"

  Scenario: a reviewer's copy with no review is refused
    Given a file ".gtd/REVIEW.orig.md" with:
      """
      # Review: abc1234
      """
    And the working tree is committed as "chore: stray copy"
    Then opening door "fix" is refused with "has no .gtd/REVIEW.md"
