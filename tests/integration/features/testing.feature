@inmem
Feature: Testing — the bounded build/test/fix loop

  Checks are the CHECK actor's turns. A landed build/fix turn rests at the
  testing state awaiting `check`: `gtd next` emits the wrapper script (the
  configured `testCommand` plus output capture), the driver executes it, and
  `gtd step check` captures the outcome from the tree — a pending FEEDBACK.md
  is a red run (`gtd(check): test-failed` below the fix-attempt cap, with t+1
  stamped into its trailer; `gtd(check): escalated` at the cap, whose routing
  chain promotes the output to ERRORS.md and rests at the human escalate
  gate), and a clean tree is green (the outcome label is decided at capture:
  `gtd(check): agentic-review`, an inline close, or the health path's
  tests-green marker). Deleting the committed ERRORS.md and landing that
  deletion as the human's escalate turn resets the fix-attempt budget.

  Scenario: A green check lands the reviewer rest after a build turn
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file "src/helper.ts" with:
      """
      export const helper = (x: string) => x
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): building"
    # The build turn rests for the check: gtd next emits the wrapper script.
    When I run gtd next
    Then it succeeds
    And stdout contains "bash gate.sh > .gtd/.check-output 2>&1"
    And stdout contains ".gtd/FEEDBACK.md"
    # Green: the script wrote nothing; the check's empty turn IS the outcome.
    When I run gtd step check
    Then it succeeds
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      chore: add .gtdrc
      gtd: building
      gtd(agent): building
      gtd(check): agentic-review
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Spawn a **reviewing subagent**"

  Scenario: A red check below the cap captures FEEDBACK.md and rests for the fix prompt
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file "src/helper.ts" with:
      """
      export const helper = (x: string) => x
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): building"
    # Red: the executed script recorded the failing output as FEEDBACK.md.
    Given a file ".gtd/FEEDBACK.md" with:
      """
      SENTINEL_FAILURE
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): test-failed"
    # The red outcome stamps the fix-attempt count into the trailer at
    # capture — the next resolve reads this ONE trailer instead of folding.
    And the last commit body contains "Gtd-Counters: t=1 r=0 h=0"
    And the file ".gtd/FEEDBACK.md" exists
    And the file ".gtd/FEEDBACK.md" contains "SENTINEL_FAILURE"
    When I run gtd next
    Then it succeeds
    And stdout contains "SENTINEL_FAILURE"
    # The fixing gate's awaited actor is the AGENT — a clean gtd step agent
    # here is a do-nothing fixer invocation: inert (no commit), not a refusal.
    Then I record the commit count
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(check): test-failed"
    And the commit count is unchanged
    When I run gtd next
    Then it succeeds
    And stdout contains "SENTINEL_FAILURE"

  Scenario: A red check at the fix-attempt cap promotes to ERRORS.md and escalates
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: test-failed" with counters "t=1 r=0 h=0"
    And a commit "gtd: test-failed" with counters "t=2 r=0 h=0"
    And a commit "gtd: test-failed" with counters "t=3 r=0 h=0"
    And a file "src/helper.ts" with:
      """
      export const helper = (x: string) => x
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): fixing"
    Given a file ".gtd/FEEDBACK.md" with:
      """
      SENTINEL_FAILURE
      """
    When I run gtd step check
    Then it succeeds
    And the git log contains "gtd(check): escalated"
    And the last commit subject is "gtd: escalated"
    # Escalation carries the spent budget unchanged (no stamp on "escalated").
    And the last commit body contains "Gtd-Counters: t=3 r=0 h=0"
    And the file ".gtd/ERRORS.md" exists
    And the file ".gtd/ERRORS.md" contains "SENTINEL_FAILURE"
    And the file ".gtd/FEEDBACK.md" does not exist
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    When I run gtd step agent
    Then it fails
    And stderr contains "awaits a human turn"

  Scenario: Removing a committed ERRORS.md resets the budget and a green re-check advances
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: escalated" that adds ".gtd/ERRORS.md" with:
      """
      Earlier escalation output.
      """
    And a deleted committed file ".gtd/ERRORS.md"
    # The human's escalate turn lands the ERRORS.md deletion and stamps the
    # budget reset (t=0, h=0) onto its own trailer, then rests for the check.
    When I run gtd step human
    Then it succeeds
    And the git log contains "gtd(human): escalate"
    And the last commit subject is "gtd(human): escalate"
    And the last commit body contains "Gtd-Counters: t=0 r=0 h=0"
    And the file ".gtd/ERRORS.md" does not exist
    # Green re-check: the reviewer rest is next.
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): agentic-review"

  Scenario: Removing a committed ERRORS.md and re-checking red writes a fresh FEEDBACK.md, not ERRORS.md again
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: escalated" that adds ".gtd/ERRORS.md" with:
      """
      Earlier escalation output.
      """
    And a deleted committed file ".gtd/ERRORS.md"
    When I run gtd step human
    Then it succeeds
    And the git log contains "gtd(human): escalate"
    # Red re-check: budget reset to zero by the escalate turn, so this is
    # below the cap again — a fresh FEEDBACK.md round, not another ERRORS.md.
    Given a file ".gtd/FEEDBACK.md" with:
      """
      STILL_BROKEN
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): test-failed"
    And the last commit body contains "Gtd-Counters: t=1 r=0 h=0"
    And the file ".gtd/FEEDBACK.md" exists
    And the file ".gtd/ERRORS.md" does not exist

  Scenario: gtd step agent refuses while the human escalate turn is awaited
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: escalated" that adds ".gtd/ERRORS.md" with:
      """
      SENTINEL_FAILURE
      """
    Then I record the commit count
    When I run gtd step agent
    Then it fails
    And stderr contains "awaits a human turn"
    And the commit count is unchanged
