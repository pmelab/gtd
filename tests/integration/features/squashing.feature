@squashing
@inmem
Feature: Squashing — collapse a cycle into one conventional-commits message

  With squash on, the approval boundary `gtd: done` is not a rest: the same
  chain continues straight to `gtd: squash template`, writing and committing a
  SQUASH_MSG.md template. `gtd next` then emits the squashing prompt for the
  agent, instructing it to overwrite SQUASH_MSG.md — no sentinel text anywhere
  in that prompt. Once the agent overwrites the template with a real message
  and runs `gtd step-agent`, the squash executes via `git reset --soft`: the
  final HEAD subject is the message's first line, SQUASH_MSG.md is gone from
  the tree and from history, the `gtd: *` commits of the cycle are gone too,
  and the commits that predate the cycle survive untouched. The squash fires
  because of the turn's position in the chain, not because of what
  SQUASH_MSG.md says — arbitrary prose still gets squashed in verbatim. With
  squash off, `gtd: done` is the resting boundary and no SQUASH_MSG.md is ever
  written.

  Scenario: gtd: done with squash on continues the chain to the squash template
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      squash: true
      """
    And a commit "gtd(human): grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd(agent): review" that adds "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: awaiting review"
    And a commit "gtd(human): review" that deletes "REVIEW.md"
    When I run gtd step
    Then it succeeds
    And the git log contains "gtd: done"
    And the git log contains "gtd: squash template"
    And the last commit subject is "gtd: squash template"
    And the file "SQUASH_MSG.md" exists

  Scenario: gtd next at the squash template rest emits the squashing prompt with no sentinel text
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      squash: true
      """
    And a commit "gtd(human): grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd(agent): review" that adds "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: awaiting review"
    And a commit "gtd(human): review" that deletes "REVIEW.md"
    And a commit "gtd: done"
    And a commit "gtd: squash template" that adds "SQUASH_MSG.md" with:
      """
      chore: replace this template with a conventional-commits message
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "SQUASH_MSG.md"
    And stdout does not contain "SENTINEL"
    And stdout does not contain "marker"

  Scenario: The agent overwrites SQUASH_MSG.md and gtd step-agent performs the squash
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      squash: true
      """
    And a commit "chore: pre-cycle work" that adds "src/existing.ts" with:
      """
      export const existing = 1
      """
    And a commit "gtd(human): grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd: building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: package done"
    And a commit "gtd(agent): review" that adds "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: awaiting review"
    And a commit "gtd(human): review" that deletes "REVIEW.md"
    And a commit "gtd: done"
    And a commit "gtd: squash template" that adds "SQUASH_MSG.md" with:
      """
      chore: replace this template with a conventional-commits message
      """
    And "SQUASH_MSG.md" is modified to:
      """
      feat: add helper

      why-body
      """
    When I run gtd step-agent
    Then it succeeds
    And the last commit subject is "feat: add helper"
    And the file "SQUASH_MSG.md" does not exist
    And the git log does not contain "gtd: squash template"
    And the git log does not contain "gtd: done"
    And the git log contains "chore: pre-cycle work"
    And the file "src/calc.ts" exists

  Scenario: Squash off — gtd: done is the resting boundary, no template ever written
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      squash: false
      """
    And a commit "gtd(human): grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd(agent): review" that adds "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: awaiting review"
    And a commit "gtd(human): review" that deletes "REVIEW.md"
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd: done"
    And the git log does not contain "gtd: squash template"
    And the file "SQUASH_MSG.md" does not exist
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""

  Scenario: Turn position, not content, triggers the squash — arbitrary prose still squashes
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      squash: true
      """
    And a commit "gtd(human): grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd(agent): review" that adds "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: awaiting review"
    And a commit "gtd(human): review" that deletes "REVIEW.md"
    And a commit "gtd: done"
    And a commit "gtd: squash template" that adds "SQUASH_MSG.md" with:
      """
      chore: replace this template with a conventional-commits message
      """
    And "SQUASH_MSG.md" is modified to:
      """
      absolutely not a conventional commit and mentions gtd: errors on purpose
      """
    When I run gtd step-agent
    Then it succeeds
    And the last commit subject is "absolutely not a conventional commit and mentions gtd: errors on purpose"
    And the file "SQUASH_MSG.md" does not exist
