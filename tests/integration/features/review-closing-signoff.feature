@live
Feature: A tick with no comment signs off — build.review.deciding reaches idle

  `build.review.deciding` is a callback step: the flow decides sign-off vs.
  feedback from the human's review commit, and the callback leaves the files
  the next steps read. A tick with no other comment or hand-edit is a clean
  sign-off, landing an ordinary commit entering the workflow's initial state
  (`idle`) — every prior turn commit stays on the branch.

  This scenario actually EXECUTES the printed check script (`gtd exec`)
  rather than simulating its outcome by hand, which `@inmem` scenarios never
  do.

  `gtd uncheck` resets every tick ahead of the human's own commit, so no
  `[x]` can reach a commit through gtd's own landing path — this scenario
  lands the human turn through `gtd land` itself, rather than hand-committing
  a ticked `.gtd/REVIEW.md`, so the tick is genuinely gone by the time
  deciding looks at the review commit.

  Scenario: a tick with no comment signs off — deciding lands an ordinary commit entering idle
    Given a test project
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"
    And ".gtd/REVIEW.md" contains "- [ ] ./src/calc.ts#1"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → idle"

  @live
  Scenario: no `.gtd/REVIEW.md` at HEAD is not a sign-off — deciding writes FEEDBACK.md and lands at a human gate
    # The one clean-tree case deciding's `rm -f .gtd/REVIEW.md` used to
    # produce. The script detects it by the file's ABSENCE, not by the diff,
    # so the broken round always carries a diff and can never be mistaken for
    # an approval of nothing.
    Given a test project
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
    # The reviewer's turn writes no `.gtd/REVIEW.md` at all.
    And a file "src/reviewer-scratch.ts" with:
      """
      export const scratch = 1
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    And a file "src/human-edit.ts" with:
      """
      export const edit = 1
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.deciding"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.review-missing"
    And ".gtd/FEEDBACK.md" exists
