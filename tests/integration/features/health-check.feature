@inmem
Feature: Health check — the idle test loop

  At idle (a clean boundary HEAD, no active package, no steering files), `gtd
  step` runs the configured `testCommand` as a health check. Green settles
  idle with zero commits. Red below the fix-attempt cap writes HEALTH.md and
  commits it as `gtd: health-check`, resting for the health-fixing prompt for
  the agent. The fixer's turn is `gtd(agent): health-fix`, which removes
  HEALTH.md and re-tests in the same chain: with squash on, a green re-test
  continues straight to `gtd: tests-green` then `gtd: squashing`; with
  squash off, it settles at a plain idle rest. Red at the cap writes ERRORS.md
  instead and escalates to the human. A clean tree at `gtd: testing` self-
  heals — `gtd next` reports idle/human, since the next invocation's health
  check will simply re-run.

  Scenario: A clean idle tree with a green gate exits 0 with zero commits
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    And I record the commit count
    When I run gtd step human
    Then it succeeds
    And the commit count is unchanged

  Scenario: A red idle gate below the cap writes and commits HEALTH.md, resting for the fix prompt
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
    When I run gtd step human
    Then it succeeds
    And the git log contains "gtd: health-check"
    And the last commit subject is "gtd: health-check"
    And the file ".gtd/HEALTH.md" exists
    And the file ".gtd/HEALTH.md" contains "SENTINEL_HEALTH_FAILURE"
    When I run gtd next
    Then it succeeds
    And stdout contains "SENTINEL_HEALTH_FAILURE"

  Scenario: The health-fixer turn removes HEALTH.md, re-tests green, and continues to squash template with squash on
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
      learning: false
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    And a commit "gtd: health-check" that adds ".gtd/HEALTH.md" with:
      """
      SENTINEL_HEALTH_FAILURE
      """
    And "gate.sh" is modified to:
      """
      echo ALL_GREEN
      exit 0
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): health-fix"
    And the git log contains "gtd: testing"
    And the git log contains "gtd: tests-green"
    And the git log contains "gtd: squashing"
    And the file ".gtd/HEALTH.md" does not exist
    And the file ".gtd/SQUASH_MSG.md" exists

  Scenario: The health-fixer turn removes HEALTH.md and settles a plain idle rest with squash off
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
      learning: false
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    And a commit "gtd: health-check" that adds ".gtd/HEALTH.md" with:
      """
      SENTINEL_HEALTH_FAILURE
      """
    And "gate.sh" is modified to:
      """
      echo ALL_GREEN
      exit 0
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): health-fix"
    And the git log contains "gtd: testing"
    And the file ".gtd/HEALTH.md" does not exist
    And the file ".gtd/SQUASH_MSG.md" does not exist
    And the git log does not contain "gtd: squashing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"pending\":false"

  Scenario: Red at the fix-attempt cap writes ERRORS.md and escalates
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
    When I run gtd step human
    Then it succeeds
    And the file ".gtd/ERRORS.md" exists
    And the file ".gtd/HEALTH.md" does not exist
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    When I run gtd step agent
    Then it fails
    And stderr contains "awaits a human turn"

  Scenario: Removing a committed ERRORS.md resets the health-check budget and re-tests from zero
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
    And a commit "gtd: health-check" that adds ".gtd/ERRORS.md" with:
      """
      Earlier health-check escalation output.
      """
    And a deleted committed file ".gtd/ERRORS.md"
    When I run gtd step human
    Then it succeeds
    And the file ".gtd/ERRORS.md" does not exist
    And the file ".gtd/HEALTH.md" does not exist

  Scenario: gtd next at a clean gtd: testing HEAD self-heals to idle/human
    Given a test project
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    And a commit "gtd: health-check" that adds ".gtd/HEALTH.md" with:
      """
      Earlier failure.
      """
    And a commit "gtd: testing" that deletes ".gtd/HEALTH.md"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""

  Scenario: The health-fixing prompt never offers the FEEDBACK.md dispute path
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "false"
      """
    And a commit "gtd: health-check" that adds ".gtd/HEALTH.md" with:
      """
      SENTINEL_HEALTH_FAILURE
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "SENTINEL_HEALTH_FAILURE"
    And stdout contains "health check"
    And stdout contains "removes `.gtd/HEALTH.md` itself"
    And stdout does not contain "empty or delete `.gtd/FEEDBACK.md`"
