@inmem
Feature: Recovery — checkpoint contract after an interrupted check

  The turn commit is a durable checkpoint: a check that never ran (driver
  crash, unrunnable command) leaves the build turn landed and the machine
  resting at the testing state for the check actor. Re-resolving is always
  safe — the same wrapper script is re-emitted, and even a boundary commit
  landed on top of the checkpoint (an operational fix) still resolves back
  to the check's rest via the checkpoint-recovery rung.

  Scenario: A build turn is a durable checkpoint; the check resumes after an operational fix lands on top
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: this-command-does-not-exist-xyz
      """
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): building"
    # The check never ran (the configured command doesn't exist). An
    # operational fix lands as a boundary commit on top of the checkpoint...
    Given a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      """
    And the working tree is committed as "chore: fix test command"
    # ...and the checkpoint-recovery rung still rests at testing for the
    # check: the same green step closes the loop as if nothing happened.
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"testing\""
    And stdout contains "\"actor\":\"check\""
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): agentic-review"
