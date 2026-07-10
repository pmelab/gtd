@inmem
Feature: gtd next — pure prediction of the next prompt

  `gtd next` is a pure introspection command: it authors nothing, ever. A dirty
  tree refuses — the tree must be resolved with `gtd status` / `gtd step`
  first. A clean tree at a rest (turn-commit HEAD awaiting an actor, or a
  routing-commit HEAD that lands on an actor) emits that actor's prompt. A
  clean tree at a mid-chain HEAD reports pending instead of a prompt.

  `--json` output carries a `runStepAgent` boolean for automated loop drivers:
  `true` at an agent rest (mirroring the plain-mode tail sentence — the driver
  should run `gtd step-agent` next), `false` at a human rest (the human's own
  next action is already spelled out in the prompt body) and `false` while
  pending (resuming a mid-chain checkpoint always runs `gtd step`, never
  `step-agent`, regardless of which actor's turn was interrupted).

  Scenario: A dirty tree fails and points at gtd status and gtd step
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/sub.ts" with:
      """
      export const sub = (a: number, b: number) => a - b
      """
    Then I record the commit count
    When I run gtd next
    Then it fails
    And stderr contains "gtd status"
    And stderr contains "gtd step"
    And the commit count is unchanged

  Scenario: A clean rest at gtd: planning emits the building prompt for the agent
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    Then I record the commit count
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "\"pending\":false"
    And stdout contains "\"runStepAgent\":true"
    And the commit count is unchanged
    When I run gtd next
    Then it succeeds
    And the commit count is unchanged

  Scenario: A clean human rest at gtd: awaiting review reports actor human
    Given a test project
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    And stdout contains "\"runStepAgent\":false"

  Scenario: A mid-chain HEAD reports pending with a null prompt
    Given a test project
    And a commit "gtd(human): review" that adds "REVIEW.md" with:
      """
      # Review

      - [x] ./src/calc.ts#1
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"pending\":true"
    And stdout contains "\"prompt\":null"
    And stdout contains "\"runStepAgent\":false"
    When I run gtd next
    Then it succeeds
    And stdout contains "run `gtd step`"

  Scenario: The plain agent prompt ends with the step-agent tail sentence
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Finish your turn by running `gtd step-agent`."

  Scenario: The --json prompt for the same agent rest omits the tail sentence but carries the runStepAgent flag
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "Finish your turn by running `gtd step-agent`."
    And stdout contains "\"runStepAgent\":true"
