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
    And the git log contains "gtd: health-check"
    And "SQUASH_MSG.md" does not exist
    # Third run: agent authors the squash message, gtd performs the squash.
    Given a file "SQUASH_MSG.md" with:
      """
      chore(health): fix gate
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "chore(health): fix gate"
    And the git log does not contain "gtd: health-check"
    And "SQUASH_MSG.md" does not exist

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

  Scenario: Uncommitted fixer output under gtd: health-check re-runs the health check (green second run)
    # Deadlock regression: dirty-health-HEAD + uncommitted code edit must commit
    # as gtd: health-fix, re-run the health check green, and settle Idle.
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      bash impl.sh
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      squash: false
      """
    And a commit "feat: initial feature" that adds "impl.sh" with:
      """
      exit 1
      """
    # First run: red → HEALTH.md → commit gtd: health-check → fix prompt.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: health-check"
    And stdout contains "Spawn a **fix subagent**"
    # Fix subagent edits code and leaves it uncommitted (per fixing.md).
    Given "impl.sh" is modified to:
      """
      exit 0
      """
    # Second run must NOT deadlock: commit fixes as gtd: health-fix, re-run green.
    When I run gtd
    Then it succeeds
    And stderr does not contain "no precedence rule matched"
    And the git log contains "gtd: health-fix"
    And stdout contains "repository is idle — nothing to do"

  Scenario: Uncommitted fixer output still failing — health-fix committed, loops back to health-check
    # Deadlock regression (red variant): even when the fix doesn't fully pass,
    # the machine must commit as gtd: health-fix and loop (not deadlock).
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      bash impl.sh
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      squash: false
      """
    And a commit "feat: initial feature" that adds "impl.sh" with:
      """
      exit 1
      """
    # First run: red → gtd: health-check → fix prompt.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: health-check"
    And stdout contains "Spawn a **fix subagent**"
    # Fix subagent edits code but it still fails — leave uncommitted.
    Given "impl.sh" is modified to:
      """
      exit 2
      """
    # Second run: commits gtd: health-fix, loops back — another gtd: health-check.
    When I run gtd
    Then it succeeds
    And stderr does not contain "no precedence rule matched"
    And the git log contains "gtd: health-fix"
    And stdout contains "Spawn a **fix subagent**"

  Scenario: Uncommitted fixer output under gtd: health-check re-runs the health check (squash:true green second run)
    # Same as the green-second-run scenario but with squash enabled.
    # After the health-fix commit makes tests green, the machine squashes.
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      bash impl.sh
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      squash: true
      """
    And a commit "feat: initial feature" that adds "impl.sh" with:
      """
      exit 1
      """
    # First run: red → HEALTH.md → commit gtd: health-check → fix prompt.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: health-check"
    And stdout contains "Spawn a **fix subagent**"
    # Fix subagent edits code and leaves it uncommitted.
    Given "impl.sh" is modified to:
      """
      exit 0
      """
    # Second run: commits gtd: health-fix, health check re-runs green → squash path (prompt emitted).
    When I run gtd
    Then it succeeds
    And stderr does not contain "no precedence rule matched"
    And stdout contains "conventional-commits squash message"
    And the git log contains "gtd: health-fix"
    And "SQUASH_MSG.md" does not exist
    # Third run: agent authors the squash message, gtd performs the squash.
    Given a file "SQUASH_MSG.md" with:
      """
      chore(health): fix gate
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "chore(health): fix gate"
    And the git log does not contain "gtd: health-fix"
    And "SQUASH_MSG.md" does not exist

  Scenario: Health-fix squash authors a real message, then cleans up (Option A)
    # Run 1: red gate → health-check commit → fix prompt.
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
    # Fix agent makes gate green and commits gtd: health-fix.
    Given a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    # Run 2: health check re-runs green → squash prompt emitted; squash NOT yet done.
    When I run gtd
    Then it succeeds
    And stdout contains "conventional-commits squash message"
    And the git log contains "gtd: health-check"
    And "SQUASH_MSG.md" does not exist
    # Agent authors the squash message.
    Given a file "SQUASH_MSG.md" with:
      """
      chore(health): fix gate
      """
    # Run 3: gtd performs the squash using SQUASH_MSG.md, then cleans up.
    When I run gtd
    Then it succeeds
    And the last commit subject is "chore(health): fix gate"
    And the git log does not contain "gtd: health-check"
    And "SQUASH_MSG.md" does not exist

  Scenario: No orphaned SQUASH_MSG.md re-seeds a feature after health squash completes
    # After health squash completes (clean boundary HEAD), running gtd again settles Idle.
    # No new-feature seed prompt and no new commit (idempotency).
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
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
    And I record the commit count
    When I run gtd
    Then it succeeds
    And stdout contains "repository is idle — nothing to do"
    And stdout does not contain "What is the next feature"
    And the commit count is unchanged
    When I run gtd
    Then it succeeds
    And stdout contains "repository is idle — nothing to do"
    And stdout does not contain "What is the next feature"
    And the commit count is unchanged
    And the file "HEALTH.md" does not exist
    And the file "SQUASH_MSG.md" does not exist

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

  Scenario: Green at fixAttemptCap with squash enabled — squash prompt fires, no edge loop
    # Regression guard: healthFixCount == fixAttemptCap must route to the squash
    # prompt (not loop into runHealthCheck 100 times). The counter alone cannot
    # distinguish green-at-cap from red-at-cap; the machine must run the health
    # check first, then key off the result.
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      squash: true
      fixAttemptCap: 1
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    And a commit "gtd: health-check"
    When I run gtd
    Then it succeeds
    And stdout contains "conventional-commits squash message"
    And stderr does not contain "edge loop exceeded"
    And stdout does not contain "edge loop exceeded"
    And "SQUASH_MSG.md" does not exist

  Scenario: Stray SQUASH_MSG.md under a boundary HEAD does not trigger New Feature
    # Regression guard (Step 4 guard): an untracked SQUASH_MSG.md present under a
    # plain boundary commit (neither gtd: done nor a health HEAD) must not be
    # captured as new-task input. The guard on !squashMsgPresent in rule 5 blocks
    # New Feature; gtd instead runs the health check and settles Idle.
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
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
    And a file "SQUASH_MSG.md" with:
      """
      feat: some stray squash message
      """
    When I run gtd
    Then it succeeds
    And stdout does not contain "holds the plan under development"
    And the git log does not contain "gtd: new task"
