@inmem
Feature: Testing — the bounded build/test/fix loop

  The build turn is `gtd step agent`: while a package is pending it runs the
  configured `testCommand`. A green gate lands `gtd: tests-green` and rests
  there — `gtd next` then emits the agentic-review prompt. A red gate below the
  fix-attempt cap writes a non-empty FEEDBACK.md and commits it as
  `gtd: test-failed` in the same chain, resting at the fixing prompt for the agent;
  `gtd step agent` refuses at that rest since it is the agent that must fix,
  but the tree is always clean by the time either command returns 0 (the
  always-clean invariant — a red run is never left uncommitted). A red gate at
  the cap writes ERRORS.md instead and stops at Escalate, a human gate: `gtd
  next` reports actor human, and `gtd step agent` refuses. Deleting the
  committed ERRORS.md and landing that deletion as the human's escalate turn
  resets the fix-attempt budget and re-tests from zero.

  Scenario: A green build turn lands tests green and rests for the review prompt
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
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      chore: test gate
      chore: add .gtdrc
      gtd: building
      gtd(agent): building
      gtd: agentic-review
      """
    And stdout contains "state:"
    And stdout does not contain "Spawn a **reviewing subagent**"
    When I run gtd next
    Then it succeeds
    And stdout contains "Spawn a **reviewing subagent**"

  Scenario: A red build turn below the cap writes FEEDBACK.md and rests for the fix prompt
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo SENTINEL_FAILURE
      exit 1
      """
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
    And the last commit subject is "gtd: test-failed"
    # The red outcome stamps the fix-attempt count into the trailer at write
    # time — the next resolve reads this ONE trailer instead of folding history.
    And the last commit body contains "Gtd-Counters: t=1 r=0 h=0"
    And the file ".gtd/FEEDBACK.md" exists
    And the file ".gtd/FEEDBACK.md" contains "SENTINEL_FAILURE"
    When I run gtd next
    Then it succeeds
    And stdout contains "SENTINEL_FAILURE"
    # The fixing gate's awaited actor is the AGENT, not the human — a second
    # gtd step agent here is a do-nothing fixer invocation: inert (no commit,
    # no re-test), not a refusal.
    Then I record the commit count
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd: test-failed"
    And the commit count is unchanged
    When I run gtd next
    Then it succeeds
    And stdout contains "SENTINEL_FAILURE"

  Scenario: A red build turn at the fix-attempt cap writes ERRORS.md and escalates
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo SENTINEL_FAILURE
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
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
    And the last commit subject is "gtd: escalated"
    # Escalation carries the spent budget unchanged (no stamp on "escalated").
    And the last commit body contains "Gtd-Counters: t=3 r=0 h=0"
    And the file ".gtd/ERRORS.md" exists
    And the file ".gtd/FEEDBACK.md" does not exist
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    When I run gtd step agent
    Then it fails
    And stderr contains "awaits a human turn"

  Scenario: Removing a committed ERRORS.md resets the budget and re-tests from zero
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
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: escalated" that adds ".gtd/ERRORS.md" with:
      """
      Earlier escalation output.
      """
    And a deleted committed file ".gtd/ERRORS.md"
    # `gtd(human): escalate` is mid-chain, not a rest: the human's turn
    # commit removing ERRORS.md immediately re-tests in the SAME invocation.
    # With a green test gate, that re-test lands straight on `gtd: tests
    # green`, resetting the fix-attempt budget from zero.
    When I run gtd step human
    Then it succeeds
    And the git log contains "gtd(human): escalate"
    And the last commit subject is "gtd: agentic-review"
    And the file ".gtd/ERRORS.md" does not exist

  Scenario: Removing a committed ERRORS.md and re-testing red writes a fresh FEEDBACK.md, not ERRORS.md again
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo STILL_BROKEN
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: escalated" that adds ".gtd/ERRORS.md" with:
      """
      Earlier escalation output.
      """
    And a deleted committed file ".gtd/ERRORS.md"
    # `gtd(human): escalate` is mid-chain: the human's turn commit removing
    # ERRORS.md immediately re-tests in the SAME invocation. With the budget
    # reset to zero and the gate still red, the re-test is below the cap
    # again, so it writes a FRESH FEEDBACK.md (not another ERRORS.md) and
    # rests for the fix prompt — all within this one `gtd step human` call.
    When I run gtd step human
    Then it succeeds
    And the git log contains "gtd(human): escalate"
    And the last commit subject is "gtd: test-failed"
    And the file ".gtd/FEEDBACK.md" exists
    And the file ".gtd/ERRORS.md" does not exist

  Scenario: gtd step agent refuses while the human escalate turn is awaited
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo SENTINEL_FAILURE
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
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
    And I run gtd step agent
    Then I record the commit count
    When I run gtd step agent
    Then it fails
    And stderr contains "awaits a human turn"
    And the commit count is unchanged
