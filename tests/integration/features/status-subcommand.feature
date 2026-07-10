@inmem
Feature: gtd status subcommand

  `gtd status` is a pure, read-only prediction for the awaited actor. It
  reports the current state, the awaited actor, the commit that would be
  authored next, and the state that commit would land in. It performs no git
  operations, runs no tests, writes no files, and authors nothing — including
  on a dirty tree.

  Scenario: A dirty boundary tree predicts the human grilling turn
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/sub.ts" with:
      """
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd status
    Then it succeeds
    And stdout contains "State:"
    And stdout contains "Awaits: human"
    And stdout contains "Predicted commit: gtd(human): grilling"
    And stdout contains "Predicted state:"

  Scenario: A clean rest at gtd: planning predicts the agent building turn
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    Then I record the commit count
    When I run gtd status
    Then it succeeds
    And stdout contains "Awaits: agent"
    And stdout contains "Predicted commit: gtd(agent): building"
    And the commit count is unchanged

  Scenario: --json emits the four StatusSummary keys
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    When I run gtd status with "--json"
    Then it succeeds
    And stdout contains "\"state\""
    And stdout contains "\"actor\""
    And stdout contains "\"predictedCommit\""
    And stdout contains "\"predictedState\""

  Scenario: status authors nothing even on a dirty tree
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    And a file ".gtd/01-add/02-notes.md" with:
      """
      Also handle negative numbers.
      """
    Then I record the commit count
    When I run gtd status
    Then it succeeds
    And the commit count is unchanged

  Scenario: status rejects extra positional arguments
    Given a test project
    When I run gtd with args "status extra"
    Then it fails
    And stderr contains "gtd status: too many arguments"
