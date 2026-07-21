@inmem
Feature: Health check — the idle test loop

  Idle (a clean boundary HEAD, no active package, no steering files) awaits
  the CHECK actor: `gtd next` emits the health wrapper script and the driver
  runs it, then steps the check. Green captures nothing — idle stays quiet
  (the inert scripted step is the driver's terminal signal). Red records the
  output as `.gtd/HEALTH.md`, captured as `gtd(check): health-check` (h+1 in
  its trailer) resting for the health-fixing prompt; red at the cap captures
  `gtd(check): escalated`, whose routing chain promotes the output to
  ERRORS.md and rests at the human escalate gate. The fixer's turn is
  `gtd(agent): health-fixing`, which removes HEALTH.md and routes
  `gtd: testing` — the re-check rest: with squash on, a green
  `gtd step check` captures `gtd(check): tests-green` and chains into the
  squash template; with squash off (and no chain owed) a green check
  captures nothing.

  Scenario: A clean idle tree with a green check exits 0 with zero commits
    Given a test project
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    And I record the commit count
    When I run gtd step check
    Then it succeeds
    And the commit count is unchanged

  Scenario: gtd next at idle emits the health wrapper script for the check actor
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "bash gate.sh > .gtd/.check-output 2>&1"
    And stdout contains ".gtd/HEALTH.md"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"check\""
    And stdout contains "\"kind\":\"scripted\""

  Scenario: A red idle check below the cap captures HEALTH.md, resting for the fix prompt
    Given a test project
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    Given a file ".gtd/HEALTH.md" with:
      """
      SENTINEL_HEALTH_FAILURE
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): health-check"
    And the last commit body contains "Gtd-Counters: t=0 r=0 h=1"
    And the file ".gtd/HEALTH.md" exists
    And the file ".gtd/HEALTH.md" contains "SENTINEL_HEALTH_FAILURE"
    When I run gtd next
    Then it succeeds
    And stdout contains "SENTINEL_HEALTH_FAILURE"

  Scenario: The health-fixer turn removes HEALTH.md; a green re-check chains to the squash template with squash on
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
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
    And a file "src/lib.ts" with:
      """
      export const lib = 2
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): health-fixing"
    And the git log contains "gtd: testing"
    And the file ".gtd/HEALTH.md" does not exist
    When I run gtd step check
    Then it succeeds
    And the git log contains "gtd(check): tests-green"
    And the git log contains "gtd: squashing"
    And the file ".gtd/SQUASH_MSG.md" exists

  Scenario: With squash off, a green re-check after the health fix captures nothing
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
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
    And a file "src/lib.ts" with:
      """
      export const lib = 2
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): health-fixing"
    And the git log contains "gtd: testing"
    And the file ".gtd/HEALTH.md" does not exist
    Then I record the commit count
    When I run gtd step check
    Then it succeeds
    And the commit count is unchanged
    And the git log does not contain "gtd: squashing"
    And the file ".gtd/SQUASH_MSG.md" does not exist
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"pending\":false"

  Scenario: A red check at the fix-attempt cap promotes to ERRORS.md and escalates
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      fixAttemptCap: 0
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    # With a zero budget the very first red check is already at the cap: the
    # capture decides against the trailer and lands the escalation.
    Given a file ".gtd/HEALTH.md" with:
      """
      SENTINEL_HEALTH_CAP
      """
    When I run gtd step check
    Then it succeeds
    And the git log contains "gtd(check): escalated"
    And the last commit subject is "gtd: escalated"
    And the file ".gtd/ERRORS.md" exists
    And the file ".gtd/ERRORS.md" contains "SENTINEL_HEALTH_CAP"
    And the file ".gtd/HEALTH.md" does not exist
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    When I run gtd step agent
    Then it fails
    And stderr contains "awaits a human turn"

  Scenario: Removing a committed ERRORS.md resets the health-check budget for the re-check
    Given a test project
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    And a commit "gtd: escalated" that adds ".gtd/ERRORS.md" with:
      """
      Earlier health-check escalation output.
      """
    And a deleted committed file ".gtd/ERRORS.md"
    When I run gtd step human
    Then it succeeds
    And the git log contains "gtd(human): escalate"
    And the last commit body contains "Gtd-Counters: t=0 r=0 h=0"
    And the file ".gtd/ERRORS.md" does not exist
    And the file ".gtd/HEALTH.md" does not exist

  Scenario: gtd next at a clean gtd: testing HEAD rests at health-check for the check actor
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
    And stdout contains "\"actor\":\"check\""
    And stdout contains "\"state\":\"health-check\""

  Scenario: The health-fixing prompt never offers the FEEDBACK.md dispute path
    Given a test project
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
