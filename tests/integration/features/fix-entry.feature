@inmem
Feature: gtd fix — start a process that goes straight into repairing failing tests

  The bundled unified template declares `fixEntry: true` on `fix-check`
  (STATES.md §10). `gtd fix` starts a BRAND NEW process there — it requires a
  clean tree resting at the initial state, exactly like `gtd review`, and writes
  one empty `gtd(human): fix-check` entry commit (no `Gtd-Review-Base:` trailer:
  a fix reviews its own fixes from the ordinary process start). `fix-check` runs
  the suite: a red run drops straight into the shared `fixing` loop (-> checking
  -> review + squash tail); a green run is a no-op back to `idle`. `@inmem`
  scenarios never execute the check script; they simulate its outcome by writing
  (red) or not writing (green) .gtd/FEEDBACK.md.

  Background:
    Given a test project
    And the workflow

  Scenario: gtd fix enters at the fix-check gate
    When I run gtd with args "fix"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-check"

  Scenario: a green suite is a no-op back to idle — nothing to fix
    When I run gtd with args "fix"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-check"
    # A clean tree at the gate = tests pass = nothing to fix -> idle.
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): fix-check → idle"

  Scenario: a red suite drops into the shared fixing loop and out through checking to reviewing
    When I run gtd with args "fix"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-check"
    # Simulate a red run: the check script left the failing output behind.
    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 test failing
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): fix-check → fixing"
    # fixing: the agent addresses the feedback and deletes it.
    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/repair.ts" with:
      """
      export const repaired = true
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): fixing → checking"
    # A now-green check hands off to the shared review + squash tail.
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): checking → reviewing"

  Scenario: refuses on a dirty working tree, authoring nothing
    Given a file "scratch.txt" with:
      """
      not committed yet
      """
    And I record the commit count
    When I run gtd with args "fix"
    Then it fails
    And stderr contains "working tree must be clean"
    And the commit count is unchanged

  Scenario: refuses when a gtd process is already underway
    Given a file ".gtd/TODO.md" with:
      """
      a sketch
      """
    And I run gtd step human
    And I record the commit count
    When I run gtd with args "fix"
    Then it fails
    And stderr contains "a process is already underway"
    And the commit count is unchanged
