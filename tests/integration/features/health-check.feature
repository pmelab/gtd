@inmem
Feature: Health check — idle test loop on a bare-idle tree

  When the repo has a clean tree and no steering files outside of an active
  process (the `!reviewable` case), gtd runs the configured `testCommand` as an
  idle health check on any branch. Green settles Idle with zero commits; red
  below the cap writes HEALTH.md and routes to Health Fixing; red at the cap
  writes ERRORS.md and escalates. Removing ERRORS.md resets the budget. An idle
  feature branch (no active process) runs the health check just like the default
  branch; only an in-process `gtd: package done` HEAD with a reviewable diff
  still routes to Clean.

  Scenario: Green idle — exits immediately, no commits, no steering files
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    And I record the commit count
    When I run gtd
    Then it succeeds
    And stdout contains "repository is idle — nothing to do"
    And the file "HEALTH.md" does not exist
    And the file "REVIEW.md" does not exist
    And the commit count is unchanged

  Scenario: Red idle below cap — writes HEALTH.md, commits gtd: health-check, routes to Health Fixing
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo SENTINEL_HEALTH_FAILURE
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: health-check"
    And the last commit subject is "gtd: health-check"
    And stdout contains "Spawn a **fix subagent**"
    And stdout contains "SENTINEL_HEALTH_FAILURE"

  Scenario: Green after health fixes with squash enabled — squashes health-check/health-fix commits
    # First run: red gate writes HEALTH.md, commits gtd: health-check.
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo HEALTH_BROKEN
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      squash: true
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: health-check"
    And the last commit subject is "gtd: health-check"
    And stdout contains "Spawn a **fix subagent**"
    # Second run: fix agent makes tests green (overwrite gate.sh to exit 0),
    # committing the fix as gtd: health-fix (via Health Fixing removing HEALTH.md).
    # Then health check re-runs green with ≥1 health-fix commit → squash path.
    Given a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    When I run gtd
    Then it succeeds
    And stdout contains "conventional-commits squash message"
    And the git log does not contain "gtd: health-fix"

  Scenario: Green after health fixes with squash disabled — STOPs Idle, health-fix commits remain
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo HEALTH_BROKEN
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      squash: false
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: health-check"
    # Second run: gate now green; health-fix commits remain (squash disabled).
    Given a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    When I run gtd
    Then it succeeds
    And stdout contains "repository is idle — nothing to do"
    And the git log contains "gtd: health-check"

  Scenario: Red at cap — writes ERRORS.md, commits gtd: health-check, escalates
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo SENTINEL_HEALTH_CAP
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      fixAttemptCap: 1
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    And a commit "gtd: health-check"
    When I run gtd
    Then it succeeds
    And the file "ERRORS.md" exists
    And the file "HEALTH.md" does not exist
    And stdout contains "was not able to fix all errors on its own"
    And stdout does not contain "Spawn a **fix subagent**"

  Scenario: Removing ERRORS.md resets the health-check budget and re-tests
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    And a commit "gtd: health-check" that adds "ERRORS.md" with:
      """
      Earlier health-check escalation output.
      """
    And a deleted committed file "ERRORS.md"
    When I run gtd
    Then it succeeds
    And the file "ERRORS.md" does not exist
    And the file "HEALTH.md" does not exist
    And stdout contains "repository is idle — nothing to do"
    And stdout does not contain "was not able to fix all errors on its own"

  Scenario: In-process Clean regression — HEAD gtd: package done with reviewable diff routes to Clean, not health check
    # E1: after a package closes (.gtd/ gone, HEAD gtd: package done) but the
    # reviewable diff is non-empty, the machine must route to Clean (write
    # REVIEW.md), not trigger the idle health check. A gtd: grilling commit makes
    # this within-process so the review base is set.
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add feature
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd: package done" that adds "src/feature.ts" with:
      """
      export const feature = () => "done"
      """
    When I run gtd
    Then it succeeds
    And stdout contains "help a human to review the changes"
    And the file "HEALTH.md" does not exist
    And the git log does not contain "gtd: health-check"

  Scenario: Idle feature branch runs the health check (green settles Idle)
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "feat: branch work" that adds "src/branch.ts" with:
      """
      export const branch = () => "branch"
      """
    And I record the commit count
    When I run gtd
    Then it succeeds
    And stdout contains "repository is idle — nothing to do"
    And stdout does not contain "help a human to review the changes"
    And the file "HEALTH.md" does not exist
    And the file "REVIEW.md" does not exist
    And the commit count is unchanged

  Scenario: Idle feature branch, red health check → Health Fixing
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo SENTINEL_HEALTH_FAILURE
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "feat: branch work" that adds "src/branch.ts" with:
      """
      export const branch = () => "branch"
      """
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: health-check"
    And the last commit subject is "gtd: health-check"
    And stdout contains "Spawn a **fix subagent**"
    And stdout contains "SENTINEL_HEALTH_FAILURE"
    And the file "REVIEW.md" does not exist

  Scenario: Idempotent across two invocations — green idle produces zero commits on both runs
    # E3: running gtd twice on a green idle repo must not accumulate commits.
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    And I record the commit count
    When I run gtd
    Then it succeeds
    And stdout contains "repository is idle — nothing to do"
    And the commit count is unchanged
    When I run gtd
    Then it succeeds
    And stdout contains "repository is idle — nothing to do"
    And the commit count is unchanged
    And the file "HEALTH.md" does not exist
    And the file "REVIEW.md" does not exist
