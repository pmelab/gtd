Feature: Review conversation re-unwind — edits from every round are reverted

  A hand-edit made in an earlier reply round is restored by the re-unwind to
  its content when the review was written, not just the last round's edits.

  Background:
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"

  @live
  Scenario: a hand-edit from an earlier reply round is reverted by the re-unwind, back to its reviewed content
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
      """
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // TODO: also export multiply
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Multiply

      Export `multiply()`.
      """
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
          - A: this is the addition helper.
      """
    And gtd lands "gtd(agent): build.review.collecting → build.review.await-review"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → re-unwind"
    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → design.triage"
    And "src/calc.ts" does not contain "TODO"
