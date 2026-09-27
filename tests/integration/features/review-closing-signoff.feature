@live
Feature: A tick with no comment signs off — build.review.closing reaches idle

  After the human's review turn lands, the flow reads that review commit. A
  `.gtd/REVIEW.md` the human left unchanged — no note, no hand-edit outside
  `.gtd/` — is a clean sign-off: `build.review.closing` removes the review
  record and lands an ordinary commit entering the workflow's initial state
  (`idle`) — every prior turn commit stays on the branch. A review commit
  carrying no `.gtd/REVIEW.md` at all is never a sign-off: it rests at the
  `build.review.review-missing` human gate instead.

  These scenarios actually EXECUTE the printed check script (`gtd exec`)
  rather than simulating its outcome by hand, which `@inmem` scenarios never
  do.

  `gtd uncheck` resets every tick ahead of the human's own commit, so no
  `[x]` can reach a commit through gtd's own landing path — this scenario
  lands the human turn through `gtd land` itself, rather than hand-committing
  a ticked `.gtd/REVIEW.md`, so the tick is genuinely gone by the time the
  flow looks at the review commit.

  Scenario: a tick with no comment signs off — closing lands an ordinary commit entering idle
    Given a test project
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
    And the last commit subject is "gtd(human): build.review.await-review → build.review.closing"
    And ".gtd/REVIEW.md" contains "- [ ] ./src/calc.ts#1"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → idle"
    And ".gtd/REVIEW.md" does not exist

  Scenario: no `.gtd/REVIEW.md` at HEAD is not a sign-off — the round rests at the review-missing human gate
    # The flow detects it by the file's ABSENCE at the review commit, not by
    # the diff, so a broken round can never be mistaken for an approval of
    # nothing.
    Given a test project
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
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
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.review-missing"
    And the git log does not contain "build.review.closing"
    When I run gtd next
    Then it succeeds
    And stdout contains "nothing to sign off on"
    # Any change at the gate re-runs the reviewer for a fresh review record.
    Given a file "NOTE.md" with:
      """
      please review again
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.review-missing → build.review.reviewing"
