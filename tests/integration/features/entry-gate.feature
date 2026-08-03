@inmem
Feature: The green-baseline entry gate — every entry runs the suite before starting

  The bundled unified template gates EVERY entry on a green test baseline
  (STATES.md §10): `idle` forks into a per-flow `*-precheck` state that runs
  the suite before any planning starts. A green run (a clean tree — the check
  script removed .gtd/FEEDBACK.md) proceeds into `planning`/`product-qa`; a
  red run (the script left .gtd/FEEDBACK.md) halts at a human `*-blocked`
  gate that loops back to the check once the human repairs the failures — the
  same shape as `escalate`. `@inmem` scenarios never execute the check script;
  they simulate its outcome by writing (red) or not writing (green)
  .gtd/FEEDBACK.md, exactly as the shared `checking` state is tested.

  Background:
    Given a test project
    And the workflow

  Scenario: simple flow — a green baseline proceeds from the gate into planning
    Given a file ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → plan-precheck"
    # A clean tree at the gate = tests pass = green -> planning.
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): plan-precheck → planning"

  Scenario: simple flow — a red baseline halts at plan-blocked, then a fix re-runs the gate to green
    Given a file ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → plan-precheck"
    # Simulate a red run: the check script left the failing output behind.
    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 test failing: baseline broken
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): plan-precheck → plan-blocked"
    # The halt message tells the human the baseline is red and names gtd fix.
    When I run gtd next
    Then it succeeds
    And stdout contains "test baseline is red"
    And stdout contains "gtd fix"
    # The human repairs the baseline in place: delete the feedback and land a fix.
    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/baseline-fix.ts" with:
      """
      export const fixed = true
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): plan-blocked → plan-precheck"
    # Re-run the gate: now green -> planning.
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): plan-precheck → planning"

  Scenario: advanced flow — a green baseline proceeds from the gate into product-qa
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget with product requirements.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → spec-precheck"
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): spec-precheck → product-qa"

  Scenario: advanced flow — a red baseline halts at spec-blocked
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget with product requirements.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → spec-precheck"
    Given a file ".gtd/FEEDBACK.md" with:
      """
      compile error: baseline broken
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): spec-precheck → spec-blocked"
