@inmem
Feature: Recovery — checkpoint contract on a mid-chain operational failure

  A mid-chain operational failure (e.g. an unconfigured test command) must not
  roll back commits already made — the turn commit is a durable checkpoint. The
  run exits non-zero at that checkpoint; `gtd next` reports pending in between
  (an agent-driven checkpoint, so it points at `gtd step agent`); fixing the
  underlying config and re-running the same step resumes the chain.

  Scenario: A build turn survives an unconfigured test command, then resumes once fixed
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
    Then it fails
    And the last commit subject is "gtd(agent): building"
    When I run gtd next
    Then it succeeds
    And stdout contains "run `gtd step agent` to continue, then run `gtd next` again"
    Given a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd: agentic-review"
