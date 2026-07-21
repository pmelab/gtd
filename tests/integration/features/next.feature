@inmem
Feature: gtd next — pure prediction of the next prompt

  `gtd next` is a pure introspection command: it authors nothing, ever. A dirty
  tree refuses — inspect it with `gtd status` and advance with the awaited
  actor's step command first. A clean tree at a rest (turn-commit HEAD awaiting an actor, or a
  routing-commit HEAD that lands on an actor) emits that actor's prompt. A
  clean tree at a mid-chain HEAD reports pending instead of a prompt.

  `--json` output's `actor` field is the single loop-driver signal: `"agent"`
  means proceed with another round — act on `prompt` when present, then run
  `gtd step agent`; at an agent-driven mid-chain checkpoint (`prompt` null)
  just run `gtd step agent` to resume the chain. `"human"` means halt: the
  human owns the next move (a human rest, whose prompt body spells out the
  human's action, or a human-driven mid-chain checkpoint resumed by
  `gtd step human`).

  Scenario: A dirty tree fails and points at gtd status and gtd step <actor>
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
    And stderr contains "gtd step <actor>"
    And the commit count is unchanged

  Scenario: A clean rest at gtd: building emits the building prompt for the agent
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
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
    And stdout does not contain "runStepAgent"
    And the commit count is unchanged
    When I run gtd next
    Then it succeeds
    And the commit count is unchanged

  Scenario: A clean human rest at gtd: await-review reports actor human
    Given a test project
    And a commit "gtd: await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    And stdout does not contain "runStepAgent"

  Scenario: A human-driven mid-chain HEAD reports pending with a null prompt
    Given a test project
    And a commit "gtd(human): review-approved" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      - [x] ./src/calc.ts#1
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"pending\":true"
    And stdout contains "\"actor\":\"human\""
    And stdout contains "\"prompt\":null"
    When I run gtd next
    Then it succeeds
    And stdout contains "run `gtd step human` to continue"

  Scenario: An agent-driven mid-chain checkpoint reports pending with actor agent
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      agenticReview: false
      squash: false
      """
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    And a commit "gtd(agent): fixing" that adds "src/add.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"pending\":true"
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "\"prompt\":null"
    When I run gtd next
    Then it succeeds
    And stdout contains "run `gtd step agent` to continue, then run `gtd next` again"

  Scenario: The plain agent prompt ends with the step-agent tail and the next-iteration instruction
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Finish your turn by running `gtd step agent`."
    And stdout contains "Then run `gtd next` and follow"
    And stdout contains "when it awaits the human, stop and hand off."

  Scenario: The --json prompt for the same agent rest omits the tail but carries the actor field
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "Finish your turn by running `gtd step agent`."
    And stdout does not contain "Then run `gtd next` and follow"
    And stdout contains "\"actor\":\"agent\""
