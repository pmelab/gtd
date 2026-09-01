@live
Feature: A tick with no comment signs off — build.review.deciding's script reaches idle

  `build.review.deciding`'s check script (`src/workflows/unified.yaml`)
  decides sign-off vs. feedback from the human's step content: a tick with no
  other comment or hand-edit is a clean sign-off, landing an ordinary commit
  entering the workflow's initial state (`idle`) — every prior turn commit
  stays on the branch. This is the one branch issue #128 broke (a
  `reviewFile` repointed outside `.gtd/` looped review forever) — now that
  every steering file sits at a fixed path under `.gtd/`, this is the only
  `@live` proof left in the suite that the collapsed `":(exclude).gtd"`
  pathspec still lets that branch through.

  This scenario actually EXECUTES the rendered script (`I execute the printed
  check script`) rather than simulating its outcome by hand — the bug this
  guards against lives in the script's own shell logic, which `@inmem`
  scenarios never run (see AGENTS.md).

  Since package 01, no `[x]` can reach a commit through gtd's own landing
  path (`gtd uncheck` resets every tick ahead of the human's own commit) —
  this scenario lands the human turn through `gtd land` itself, rather than
  hand-committing a ticked `.gtd/REVIEW.md`, so the tick is genuinely gone by
  the time `deciding`'s script runs its diff comparison.

  Scenario: a tick with no comment signs off — deciding's script lands an ordinary commit entering idle
    Given a test project
    And a commit "gtd(agent): build.health.check → build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
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
  Scenario: no `.gtd/REVIEW.md` at HEAD is not a sign-off — deciding's script writes FEEDBACK.md and lands at a human gate
    # The one clean-tree case deciding's `rm -f .gtd/REVIEW.md` used to
    # produce. The script detects it by the file's ABSENCE, not by the diff,
    # so the broken round always carries a diff and can never be mistaken for
    # an approval of nothing.
    Given a test project
    And an empty commit "gtd(agent): build.health.check → build.review.reviewing"
    And an empty commit "gtd(human): build.review.await-review → build.review.deciding"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.review-missing"
    And ".gtd/FEEDBACK.md" exists
