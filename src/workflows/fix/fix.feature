Feature: fix fixes the notes review hands it

  `review` and `fix` meet only in `.gtd/REVIEW.md`: a review the human leaves
  a note in ends with the reviewer's copy kept beside it, and `gtd door fix`
  picks both up.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"

  Scenario: a note left in review is fixed, and both review files are removed
    Given step "review-gate.check" changes nothing
    And step "build.health.check" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        new add function
      """
    When gtd opens door "review" with "HEAD~1"
    And the process is driven
    Then the process rests at "build.review.await-review"

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        new add function — rename it to sum
      """
    And step "build.review.handing-off" runs its script
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/REVIEW.orig.md" contains "new add function"

    Given step "notes.fixing" writes "src/calc.ts" with:
      """
      export const sum = (a: number, b: number) => a + b
      """
    And step "notes.closing" runs its script
    When gtd opens door "fix"
    Then the resting step's content contains "rename it to sum"
    # The fix goes to its own review, which the same scripted reviewer writes
    # afresh — the handed-off review itself is gone, as the reviewer's copy shows.
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
