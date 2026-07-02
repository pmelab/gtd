@squashing
Feature: Squashing — collapse gtd: * commits into one conventional-commits message

  After `gtd: done` closes the process, a Squashing prompt is emitted so the
  agent can squash all `gtd: *` commits (and any interleaved non-gtd commits)
  into a single, clean conventional-commits message via `git reset --soft`.

  Scenario: Happy path — Squashing prompt fires after gtd: done
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add calculator
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd: building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: package done"
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review
      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: done" that deletes "REVIEW.md"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Squash all `gtd: *` commits into one conventional-commits message"
    And stdout contains "git reset --soft"
    And stdout contains "src/calc.ts"
    And stdout contains "Re-run gtd immediately after completing the steps above."
    And stdout does not contain "STOP — do not re-run"

  Scenario: Interleaved non-gtd commit appears in the squash diff
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add calculator
      """
    And a commit "feat: coworker" that adds "coworker.ts" with:
      """
      export const coworker = () => "helping"
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd: building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: package done"
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review
      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: done" that deletes "REVIEW.md"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Squash all `gtd: *` commits into one conventional-commits message"
    And stdout contains "git reset --soft"
    And stdout contains "coworker.ts"

  Scenario: Squash disabled via config — Idle instead of Squashing
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      squash: false
      """
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add calculator
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd: building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: package done"
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review
      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: done" that deletes "REVIEW.md"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Nothing to do"
    And stdout does not contain "## Task: Squash all `gtd: *` commits into one conventional-commits message"

  Scenario: Already squashed — plain boundary commit yields Idle
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Nothing to do"
    And stdout does not contain "## Task: Squash all `gtd: *` commits into one conventional-commits message"
