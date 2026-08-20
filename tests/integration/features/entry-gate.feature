Feature: The green-baseline entry gate — every entry runs the suite before starting

  The bundled unified template gates EVERY entry on a green test baseline
  (STATES.md §10): `idle` has a single edge into `unwind`, which reverts the
  entry commit's diff — via `git revert --no-commit` — before `start-gate.check`
  ever runs. By the time the gate's own suite run happens, the working tree
  already IS the baseline, so all three entries (`start-gate`, `review-gate`,
  `gtd --entry fix-precheck`) now share the exact same plain rule: block on
  any red tree, full stop. A red run halts at the human `start-gate.blocked`
  gate that loops back to the check once the human repairs the failures — the
  same shape as `escalate`.

  `@inmem` scenarios never execute the unwind/check scripts; they simulate
  their outcome directly — the unwind's `git revert` by deleting whatever the
  entry commit added, the check's suite run by writing (red) or not writing
  (green) `.gtd/FEEDBACK.md` — exactly as the shared `checking` state is
  tested elsewhere. `@live` scenarios prove the real scripts (`I execute the
  printed check script`), with a real test command standing in for the suite
  (`GTD_TESTCOMMAND`).

  @inmem
  Scenario: a green baseline proceeds from the gate into design.triage
    Given a test project
    And the workflow
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"

    # Simulate the unwind's `git revert --no-commit` — @inmem never executes
    # scripts — by reverting the tree to the start commit ourselves.
    Given the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → start-gate.check"

    # A clean tree at the gate = tests pass = green -> design.triage.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"

  @inmem
  Scenario: a red baseline halts at start-gate.blocked, then a fix re-runs the gate to green
    Given a test project
    And the workflow
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"

    Given the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → start-gate.check"

    # Simulate a red run: the check script left the failing output behind.
    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 test failing: baseline broken
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → start-gate.blocked"
    # The halt message tells the human the baseline is red and names the fix entry.
    When I run gtd next
    Then it succeeds
    And stdout contains "test baseline is red"
    And stdout contains "gtd --entry fix-precheck"
    # The human repairs the baseline in place: delete the feedback and land a fix.
    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/baseline-fix.ts" with:
      """
      export const fixed = true
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start-gate.blocked → start-gate.check"
    # Re-run the gate: now green -> design.triage.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"

  @live
  Scenario: a green baseline proceeds from the gate into design.triage
    Given a test project
    And the workflow
    And GTD_TESTCOMMAND is set to "true"
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"

    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → start-gate.check"
    And "NOTE.md" does not exist

    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"
    And ".gtd/FEEDBACK.md" does not exist

  @live
  Scenario: the unwind reverts a note and a hand-edited code change alike, restoring the start commit while both survive in the entry commit
    Given a test project
    And the workflow
    And GTD_TESTCOMMAND is set to "true"
    And a file "src/real.ts" with:
      """
      export const real = 1
      """
    And a file "SCRATCH.md" with:
      """
      idea: also expose a helper that doubles real
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"

    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → start-gate.check"
    # The revert restores the tree to exactly the start commit — the scratch
    # note and the hand-edited real code change are BOTH gone from the
    # working tree, with no distinction between them.
    And "src/real.ts" does not exist
    And "SCRATCH.md" does not exist
    # Both survive, readable, in the entry commit — a separate commit from
    # the unwind itself, never squashed together with it.
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      chore: init gtd workflow
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      """

  @live
  Scenario: a red baseline halts at start-gate.blocked with the failing output recorded
    Given a test project
    And the workflow
    And GTD_TESTCOMMAND is set to "false"
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"

    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → start-gate.check"
    And "NOTE.md" does not exist

    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → start-gate.blocked"
    And ".gtd/FEEDBACK.md" contains "the test command failed"
