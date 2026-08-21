@live
Feature: A step whose diff deletes its own file: skips a mode's format: command

  A mode's `format:`/`validate:` pair is emitted into the step script AHEAD of
  the commit (`src/program.ts`'s `steeringModeSteps`) — but a step whose whole
  diff IS that `file:`'s deletion (a review sign-off's only change is deleting
  `.gtd/REVIEW.md`) has nothing left to format, and running the formatter
  anyway makes the step UNLANDABLE: `format:` is the first command in a
  `set -euo pipefail` script, and a real formatter (`prettier --write`,
  modelled below) exits non-zero on a path that is not there, aborting the
  whole script before the commit. A driver would see only a non-zero exit with
  the failure buried in its log. `steeringModeSteps` skips the format/validate
  pair for exactly this case (`deletesFile`, shared with the step-capture
  guards) — see AGENTS.md's "Step-capture guards" section.

  This scenario actually EXECUTES the rendered script (`I execute the printed
  check script`) rather than simulating its outcome by hand — the bug lives in
  the emitted script itself, which `@inmem` scenarios never run.

  Scenario: the sign-off still lands when the review mode declares a format command that fails on a missing file
    Given a test project
    And the workflow
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        review:
          format: |
            test -f <%= it.file %> || {
              echo "No files matching the pattern were found: <%= it.file %>" >&2
              exit 2
            }
      """
    And a commit "gtd(agent): build.health.check → build.review.reviewing" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And a commit "gtd(human): build.review.await-review → build.review.deciding" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function
      """
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.squashing"
    And ".gtd/REVIEW.md" does not exist
