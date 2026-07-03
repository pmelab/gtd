@squashing
@inmem
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
    And stdout contains "Write the commit message"
    And stdout contains "SQUASH_MSG.md"
    And stdout contains "src/calc.ts"
    And stdout contains "Re-run gtd immediately after completing the steps above."
    And stdout does not contain "STOP — do not re-run"
    And stdout contains "Do not run"

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
    And stdout contains "Write the commit message"
    And stdout contains "SQUASH_MSG.md"
    And stdout contains "coworker.ts"
    And stdout contains "Re-run gtd immediately after completing the steps above."
    And stdout does not contain "STOP — do not re-run"
    And stdout contains "Do not run"

  @squashing
  Scenario: SQUASH_MSG.md present — gtd performs the squash commit on next run
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
    And a file "SQUASH_MSG.md" with content:
      """
      feat(calc): add calculator

      Decided during grilling to use simple addition only.
      """
    When I run gtd
    Then it succeeds
    And the HEAD commit subject is "feat(calc): add calculator"
    And "SQUASH_MSG.md" does not exist
    And "src/calc.ts" exists
    And stdout does not contain "Re-run gtd immediately"

  @squashing
  Scenario: SQUASH_MSG.md present alone does not cause codeDirty
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
    And a file "SQUASH_MSG.md" with content:
      """
      feat(calc): add calculator
      """
    When I run gtd
    Then it succeeds
    And the HEAD commit subject is "feat(calc): add calculator"

  @squashing
  Scenario: Untracked SQUASH_MSG.md — squash fires, not New Feature
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
    And a file "SQUASH_MSG.md" with content:
      """
      feat(calc): add calculator

      Decided during grilling to use simple addition only.
      """
    When I run gtd
    Then it succeeds
    And the HEAD commit subject is "feat(calc): add calculator"
    And "SQUASH_MSG.md" does not exist
    And "src/calc.ts" exists
    And stdout does not contain "## Task: Grill the plan in `TODO.md`"
    And "TODO.md" does not exist

  @squashing
  Scenario: SQUASH_MSG.md plus unrelated dirty code — New Feature, not squash
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
    And a file "SQUASH_MSG.md" with content:
      """
      feat(calc): add calculator

      Decided during grilling to use simple addition only.
      """
    And a file "src/extra.ts" with content:
      """
      export const extra = () => "unrelated dirty code"
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Grill the plan in `TODO.md`"
    And "TODO.md" exists
    And stdout does not contain "## Task: Squash all `gtd: *` commits into one conventional-commits message"

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

  @squashing
  Scenario: Post-squash on feature branch — manual gtd run triggers review
    Given a test project
    And a branch "feature"
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
    And a file "SQUASH_MSG.md" with content:
      """
      feat(calc): add calculator
      """
    When I run gtd
    Then it succeeds
    And the HEAD commit subject is "feat(calc): add calculator"
    And stdout does not contain "Re-run gtd immediately"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
