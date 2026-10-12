Feature: review hands its notes to fix — the two workflows meet only in .gtd/REVIEW.md

  The shipped `review` workflow never re-plans. A review the human signs off
  is closed; one the human leaves notes in ends the process with
  `.gtd/REVIEW.md` kept and the reviewer's own version copied beside it as
  `.gtd/REVIEW.orig.md` (`build.review.handing-off`). `gtd door fix` then
  finds that review in the tree, fixes every note and `Risk:` in one turn
  (`notes.fixing`), removes both files (`notes.closing`) and hands the result
  to its own review. `@inmem` scenarios simulate each script by hand; the
  `@live` one executes the hand-off script.

  Background:
    Given a test project
    And the workflow gtd install scaffolds
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
        new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"

  @inmem
  Scenario: a review with only a tick signs off and closes, leaving nothing for fix
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [x] ./src/calc.ts#1
        new add function
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.closing"

  @inmem
  Scenario: review leaves a note for fix, and fix fixes it from the review notes
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
        new add function — rename it to sum
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.handing-off"
    Given a file ".gtd/REVIEW.orig.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
        new add function
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.handing-off → idle"
    And ".gtd/REVIEW.md" contains "rename it to sum"

    When I run gtd with args "door fix"
    Then it succeeds
    And the last commit subject is "gtd(human): notes.fixing"
    When I run gtd next
    Then it succeeds
    And stdout contains "rename it to sum"
    Given a file "src/calc.ts" with:
      """
      export const sum = (a: number, b: number) => a + b
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): notes.fixing → notes.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    And the file ".gtd/REVIEW.orig.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): notes.closing → build.health.check"

  @inmem
  Scenario: a praise-only note is handed to fix, which lands it with no change
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
        new add function — LGTM
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.handing-off"
    Given a file ".gtd/REVIEW.orig.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
        new add function
      """
    When I run gtd land
    Then it succeeds
    When I run gtd with args "door fix"
    Then it succeeds
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): notes.fixing → notes.closing"

  @live
  Scenario: the hand-off script copies the reviewer's own version beside the human's notes
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
        new add function — rename it to sum
      """
    And I run gtd land
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.handing-off → idle"
    And ".gtd/REVIEW.orig.md" contains "new add function"
    And ".gtd/REVIEW.orig.md" does not contain "rename it to sum"
    And ".gtd/REVIEW.md" contains "rename it to sum"
