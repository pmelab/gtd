@learning
@inmem
Feature: Learning phase — distill and persist project memory before the squash

  With learning on, the approval boundary `gtd: done` (or the health-fix path's
  green re-test) is not a rest: the chain continues straight to
  `gtd: learning`, writing and committing a `.gtd/LEARNINGS.md`
  template. `gtd next` then emits the learning prompt for the agent,
  instructing it to distill durable lessons from the cycle's test failures,
  review feedback, and health-check rounds. Once the agent overwrites the
  template with real content and runs `gtd step agent`, the draft is captured
  (`gtd(agent): learning`) and routed to `gtd: await-learning-review`, resting at
  `await-learning-review` for a human. The human either accepts the draft
  as-is (an empty turn) or edits it — either way there is no reject path, so
  the very next `gtd step human` always proceeds to `gtd: learning-apply`,
  resting at `learning-apply` for the agent. The agent integrates the
  approved learnings into the project's own docs; its turn
  (`gtd(agent): learning-apply`) is routed to `gtd: learning-applied`, which
  removes `.gtd/LEARNINGS.md` and then runs the same squash decision `gtd:
  done` runs today: squash on continues to `gtd: squashing`, squash off
  rests at idle. Learning and squash are orthogonal — either can be enabled
  independently. With learning off, `gtd: done` (and the health-fix green
  re-test) behaves exactly as it does today: no `.gtd/LEARNINGS.md` is ever
  written.

  Scenario: gtd: done with learning on continues the chain to the learning template
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      learning: true
      squash: true
      """
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: await-review"
    And a commit "gtd(human): review-approved" that deletes ".gtd/REVIEW.md"
    When I run gtd step human
    Then it succeeds
    And the git log contains "gtd: done"
    And the git log contains "gtd: learning"
    And the last commit subject is "gtd: learning"
    And the file ".gtd/LEARNINGS.md" exists

  Scenario: gtd next at the learning template rest emits the learning prompt with the full-process diff
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      learning: true
      """
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd(agent): building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: close-package"
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: await-review"
    And a commit "gtd(human): review-approved" that deletes ".gtd/REVIEW.md"
    And a commit "gtd: done"
    And a commit "gtd: learning" that adds ".gtd/LEARNINGS.md" with:
      """
      <!-- gtd: replace this file's content with the actual distilled learnings for this cycle. -->

      ## Learnings

      - ...
      """
    When I run gtd next
    Then it succeeds
    And stdout contains ".gtd/LEARNINGS.md"
    And stdout contains "distilled learnings"
    And stdout contains "src/calc.ts"

  Scenario: The agent overwrites LEARNINGS.md and gtd step agent captures the draft, resting for human review
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      learning: true
      """
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: await-review"
    And a commit "gtd(human): review-approved" that deletes ".gtd/REVIEW.md"
    And a commit "gtd: done"
    And a commit "gtd: learning" that adds ".gtd/LEARNINGS.md" with:
      """
      <!-- gtd: replace this file's content with the actual distilled learnings for this cycle. -->

      ## Learnings

      - ...
      """
    And ".gtd/LEARNINGS.md" is modified to:
      """
      ## Learnings

      - Tests were failing because the helper mutated its input; prefer pure
        functions in this codebase.
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): learning"
    And the last commit subject is "gtd: await-learning-review"
    And the file ".gtd/LEARNINGS.md" exists
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""

  Scenario: The unmodified LEARNINGS.md template never proceeds — the machine rests until real content is written
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      learning: true
      """
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a calculator.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: await-review"
    And a commit "gtd(human): review-approved" that deletes ".gtd/REVIEW.md"
    And a commit "gtd: done"
    And a commit "gtd: learning" that adds ".gtd/LEARNINGS.md" with:
      """
      <!-- gtd: replace this file's content with the actual distilled learnings for this cycle. -->
      <!-- Keep only durable, generalizable lessons — delete anything that's a one-off detail. -->

      ## Learnings

      - ...
      """
    Then I record the commit count
    When I run gtd step agent
    Then it succeeds
    And the commit count is unchanged
    And the last commit subject is "gtd: learning"
    When I run gtd next
    Then it succeeds
    And stdout contains ".gtd/LEARNINGS.md"

  Scenario: The human accepts the draft as-is — an empty turn still proceeds to learning-apply
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      learning: true
      """
    And a commit "gtd(agent): learning" that adds ".gtd/LEARNINGS.md" with:
      """
      ## Learnings

      - Keep fixtures small and composable.
      """
    And a commit "gtd: await-learning-review"
    When I run gtd step human
    Then it succeeds
    And the git log contains "gtd(human): learning"
    And the last commit subject is "gtd: learning-apply"
    And the file ".gtd/LEARNINGS.md" exists

  Scenario: The human edits LEARNINGS.md — there is no reject path, it still proceeds to learning-apply
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      learning: true
      """
    And a commit "gtd(agent): learning" that adds ".gtd/LEARNINGS.md" with:
      """
      ## Learnings

      - Keep fixtures small and composable.
      - Some detail worth dropping.
      """
    And a commit "gtd: await-learning-review"
    And ".gtd/LEARNINGS.md" is modified to:
      """
      ## Learnings

      - Keep fixtures small and composable.
      """
    When I run gtd step human
    Then it succeeds
    And the git log contains "gtd(human): learning"
    And the last commit subject is "gtd: learning-apply"
    And the file ".gtd/LEARNINGS.md" contains "Keep fixtures small and composable."
    And the file ".gtd/LEARNINGS.md" does not contain "Some detail worth dropping."

  Scenario: The agent applies the learnings, removing LEARNINGS.md and continuing to the squash template
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      learning: true
      squash: true
      """
    And a commit "chore: pre-cycle work" that adds "src/existing.ts" with:
      """
      export const existing = 1
      """
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a calculator.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd(agent): building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: close-package"
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: await-review"
    And a commit "gtd(human): review-approved" that deletes ".gtd/REVIEW.md"
    And a commit "gtd: done"
    And a commit "gtd: learning" that adds ".gtd/LEARNINGS.md" with:
      """
      ## Learnings

      - Prefer pure functions for arithmetic helpers.
      """
    And a commit "gtd(agent): learning"
    And a commit "gtd: await-learning-review"
    And a commit "gtd(human): learning"
    And a commit "gtd: learning-apply"
    And a file "AGENTS.md" with:
      """
      Prefer pure functions for arithmetic helpers.
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): learning-apply"
    And the git log contains "gtd: learning-applied"
    And the last commit subject is "gtd: squashing"
    And the file ".gtd/LEARNINGS.md" does not exist
    And the file ".gtd/SQUASH_MSG.md" exists
    And the file "AGENTS.md" contains "Prefer pure functions for arithmetic helpers."
    And the file "src/calc.ts" exists
    And the file "src/existing.ts" exists

  Scenario: With squash off, the agent's applied learnings settle at a plain idle rest
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      learning: true
      squash: false
      """
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a calculator.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: await-review"
    And a commit "gtd(human): review-approved" that deletes ".gtd/REVIEW.md"
    And a commit "gtd: done"
    And a commit "gtd: learning" that adds ".gtd/LEARNINGS.md" with:
      """
      ## Learnings

      - Nothing durable this cycle.
      """
    And a commit "gtd(agent): learning"
    And a commit "gtd: await-learning-review"
    And a commit "gtd(human): learning"
    And a commit "gtd: learning-apply"
    And a file "AGENTS.md" with:
      """
      Nothing durable this cycle.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd: learning-applied"
    And the file ".gtd/LEARNINGS.md" does not exist
    And the file ".gtd/SQUASH_MSG.md" does not exist
    And the git log does not contain "gtd: squashing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""

  Scenario: learning off — gtd: done chains straight to the squash template, no LEARNINGS.md ever written
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      learning: false
      squash: true
      """
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a calculator.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: await-review"
    And a commit "gtd(human): review-approved" that deletes ".gtd/REVIEW.md"
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd: squashing"
    And the git log does not contain "gtd: learning"
    And the file ".gtd/LEARNINGS.md" does not exist

  Scenario: The health-fixer's green re-test chains to the learning template before the squash template
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo HEALTH_BROKEN
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      learning: true
      squash: true
      """
    And a commit "feat: initial feature" that adds "src/lib.ts" with:
      """
      export const lib = 1
      """
    And a commit "gtd: health-check" that adds ".gtd/HEALTH.md" with:
      """
      SENTINEL_HEALTH_FAILURE
      """
    And "gate.sh" is modified to:
      """
      echo ALL_GREEN
      exit 0
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): health-fix"
    And the git log contains "gtd: testing"
    And the git log contains "gtd: tests-green"
    And the git log contains "gtd: learning"
    And the last commit subject is "gtd: learning"
    And the file ".gtd/HEALTH.md" does not exist
    And the file ".gtd/LEARNINGS.md" exists
    And the git log does not contain "gtd: squashing"
