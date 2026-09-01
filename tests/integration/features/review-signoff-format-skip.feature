@live
Feature: A review sign-off lands even when its mode declares a format: command that fails on a missing file

  Package 2, Requirement A removed the mode's `format:`/`validate:` pair from
  `gtd land`'s own emitted script entirely — that script is only the HEAD
  assertion and the commit now, for every step regardless of whether its diff
  deletes the state's own `file:` (a review sign-off's only change is deleting
  `.gtd/REVIEW.md`). Before that package, a formatter that exits non-zero on a
  missing path (`prettier --write`, modelled below) would have made a
  sign-off's step UNLANDABLE — `format:` was the first command in a
  `set -euo pipefail` script, and its failure aborted the whole script before
  the commit. `deletesFile` (`src/StepGuards.ts`) still exists and is still
  shared by the step-capture guards (see AGENTS.md's "Step-capture guards"
  section) — it just no longer has a `steeringModeSteps` caller to skip a
  format command for, since there is no such caller left in the landing path.

  This scenario actually EXECUTES the rendered script (`I execute the printed
  check script`) rather than simulating its outcome by hand — `@inmem`
  scenarios never run the emitted script at all.

  Since package 01, no `[x]` can reach a commit through gtd's own landing
  path (`gtd uncheck` resets every tick ahead of the human's own commit) —
  this scenario lands the human turn through `gtd land` itself, rather than
  hand-committing a ticked `.gtd/REVIEW.md`, so the tick is genuinely gone by
  the time `deciding`'s script runs its diff comparison.

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
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → idle"
    And ".gtd/REVIEW.md" does not exist
