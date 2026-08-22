@inmem
Feature: gtd --entry fix-precheck — start a process that goes straight into repairing failing tests

  The bundled unified template declares `entry: true` on `fix-precheck`.
  `gtd --entry fix-precheck` (always authenticated as `human`) starts a BRAND
  NEW process there — resting at the initial state is required, but the
  working tree need not be clean: whatever it carries is CAPTURED into the
  entry commit (`commitAllWithPrefix`), exactly like an ordinary `gtd land`.
  It writes one `gtd(human): fix-precheck` entry commit (no `Gtd-Review-Base:`
  trailer: a fix reviews its own fixes from the ordinary process start).
  `fix-precheck` runs the suite: a red run drops straight into the shared
  `build.fix` loop (-> `build.health.check` -> review + squash tail); a green run is a no-op
  back to `idle`. `@inmem` scenarios never execute the check script; they
  simulate its outcome by writing (red) or not writing (green)
  .gtd/FEEDBACK.md.

  Background:
    Given a test project
    And the workflow

  Scenario: gtd --entry fix-precheck enters at the fix-precheck gate
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-precheck"

  Scenario: a green suite is a no-op back to idle — nothing to fix
    Given I record the commit count
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-precheck"
    # A clean tree at the gate = tests pass = nothing to fix -> idle. The
    # empty entry commit and the no-op check are collapsed away entirely — a
    # no-op probe must never dirty the log. The collapse itself SETTLES.
    When I run gtd land
    Then it settles
    And the commit count is unchanged
    And the git status is clean
    And the git log does not contain "gtd("

  Scenario: a red suite drops into the shared build.fix loop and out through build.health.check to build.review.reviewing
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-precheck"
    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 test failing
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): fix-precheck → build.fix"
    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/repair.ts" with:
      """
      export const repaired = true
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"

  Scenario: a dirty working tree is captured into the entry commit, not refused
    Given a file "scratch.txt" with:
      """
      not committed yet
      """
    And I record the commit count
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-precheck"

  Scenario: refuses when a gtd process is already underway
    Given a file "NOTE.md" with:
      """
      a sketch
      """
    And I run gtd land
    And I record the commit count
    When I run gtd with args "--entry fix-precheck"
    Then it fails
    And stderr contains "a process is already underway"
    And the commit count is unchanged
