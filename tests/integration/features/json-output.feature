@inmem
Feature: JSON output mode

  The --json flag switches step/step-agent, next, and status from plain-text
  output to a single-line JSON object. step/step-agent emit
  { state, actions, commits }; next emits
  { state, actor, pending, prompt }; status emits
  { state, actor, predictedCommit, predictedState }. next's `actor` is the
  single loop-driver signal: "agent" means proceed with another round (act on
  the prompt when present, then run `gtd step-agent`), "human" means halt —
  the human owns the next move. `autoAdvance` and `runStepAgent` no longer
  appear anywhere. Errors emit { state: "error", prompt: "<message>" } and
  exit 1.

  Scenario: gtd step --json emits state, actions, and commits
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/sub.ts" with:
      """
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd step with "--json"
    Then it succeeds
    And stdout contains "\"state\""
    And stdout contains "\"actions\""
    And stdout contains "\"commits\""
    And stdout does not contain "autoAdvance"

  Scenario: gtd next --json emits state, actor, pending, and prompt
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\""
    And stdout contains "\"actor\""
    And stdout contains "\"pending\""
    And stdout contains "\"prompt\""
    And stdout does not contain "runStepAgent"
    And stdout does not contain "autoAdvance"

  Scenario: gtd status --json emits state, actor, predictedCommit, and predictedState
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    When I run gtd status with "--json"
    Then it succeeds
    And stdout contains "\"state\""
    And stdout contains "\"actor\""
    And stdout contains "\"predictedCommit\""
    And stdout contains "\"predictedState\""
    And stdout does not contain "autoAdvance"

  Scenario: A dirty tree under gtd next --json emits the error envelope and exits 1
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/sub.ts" with:
      """
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd next with "--json"
    Then it fails
    And stdout contains "\"state\":\"error\""
    And stdout contains "\"prompt\""

  Scenario: format subcommand rejects --json flag
    Given a test project
    And a file ".gtd/TODO.md" with:
      """
      # Plan
      """
    When I run gtd with args "format --json"
    Then it fails
    And stderr contains "does not accept --json"
