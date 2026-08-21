@live
Feature: A tick with no comment signs off — build.review.deciding's script reaches build.squashing

  `build.review.deciding`'s check script (`src/workflows/unified.yaml`)
  decides sign-off vs. feedback from the human's step content: a tick with no
  other comment or hand-edit is a clean sign-off, landing at `build.squashing`.
  This is the one branch issue #128 broke (a `reviewFile` repointed outside
  `.gtd/` looped review forever) — now that every steering file sits at a
  fixed path under `.gtd/`, this is the only `@live` proof left in the suite
  that the collapsed `":(exclude).gtd"` pathspec still lets that branch
  through.

  This scenario actually EXECUTES the rendered script (`I execute the printed
  check script`) rather than simulating its outcome by hand — the bug this
  guards against lives in the script's own shell logic, which `@inmem`
  scenarios never run (see AGENTS.md).

  Scenario: a tick with no comment signs off — deciding's script lands at build.squashing
    Given a test project
    And a commit "gtd(agent): build.health.check → build.review.reviewing" that adds ".gtd/REVIEW.md" with:
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
    And the working tree is committed as "gtd(human): build.review.await-review → build.review.deciding"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.squashing"
