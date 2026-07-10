@inmem
Feature: gtd step — the human mutator

  `gtd step` advances the machine to fixpoint: it authors the turn commit for
  the awaited human gate (plus any routing chain), then stops. It is
  idempotent — re-running at a fixpoint authors zero commits. At idle it runs
  the health check: green exits 0 with zero commits, red writes and commits
  HEALTH.md as `gtd: health-check`.

  Scenario: A dirty tree at a boundary HEAD authors gtd(human): grilling and stops
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/sub.ts" with:
      """
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    And stdout contains "state: grilling"
    Then I record the commit count
    When I run gtd step
    Then it succeeds
    And the commit count is unchanged

  Scenario: Idempotence — a second gtd step right after authors zero new commits
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/sub.ts" with:
      """
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd step
    Then it succeeds
    Then I record the commit count
    When I run gtd step
    Then it succeeds
    And the commit count is unchanged

  Scenario: An empty human turn at the grilling answer gate accepts and advances to gtd: grilled
    Given a test project
    And a commit "gtd(human): grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      <!-- user answers here -->
      """
    And a commit "gtd(agent): grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator with add and subtract.

      no open questions — run gtd to plan
      """
    When I run gtd step
    Then it succeeds
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      gtd(human): grilling
      gtd(agent): grilling
      gtd(human): grilling
      gtd: grilled
      """

  Scenario: Out-of-turn human step while the agent is awaited on a clean tree is a no-op
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    Then I record the commit count
    When I run gtd step
    Then it succeeds
    And the commit count is unchanged

  Scenario: Out-of-turn human step while the agent is awaited on a dirty tree records one feedback commit
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
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): building"
    And the commit count increased by 1

  Scenario: Idle with a green health check exits 0 with zero commits
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      """
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    Then I record the commit count
    When I run gtd step
    Then it succeeds
    And the commit count is unchanged
