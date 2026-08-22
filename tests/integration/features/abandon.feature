@inmem
Feature: gtd abandon — end the process underway without completing it

  `gtd --entry <state>` refuses while a process is underway ("finish it, or run
  `gtd abandon`"), and a workflow only leaves a process through its own squash
  finale. `gtd abandon` is the way out of one nobody is going to finish: it
  closes any open review checkout window (the shared bracket every state
  subcommand runs), then rewinds HEAD to the commit the process started from —
  the same boundary a squash resets to.

  Nothing is discarded: every turn commit is dropped, and everything they
  carried (the code, the `.gtd/` steering files) stays in the working tree as
  uncommitted changes. Resting at the initial state is a no-op SUCCESS — a
  recovery command that fails when there is nothing to recover is a worse tool.

  Background:
    Given a test project
    And the workflow

  Scenario: abandons a process mid-flight — HEAD back at the process boundary, the work kept as pending changes
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"
    # Abandon here, still resting AT unwind, before its own script lands: past
    # that point the sketch survives only in retained history, never as a
    # pending edit again — unwind's whole job is removing it from the tree.
    When I run gtd with args "abandon"
    Then it succeeds
    # Plain text prints the pasteable script itself — the rendered "abandoned
    # the process resting at ..." prose is printed by the script when a driver
    # RUNS it (script-outcomes.feature's own @live-only coverage), not by gtd
    # deciding; this only proves the script calls the right outcome function
    # with the right resting state.
    And stdout contains "gtd_report_abandoned 'unwind'"
    And the last commit subject is "chore: init gtd workflow"
    And the git status contains "NOTE.md"
    And "NOTE.md" contains "Build a thing."
    When I run gtd next
    Then it succeeds
    And stdout contains "State: idle"

  Scenario: retains the abandoned tip on the retained-history ref
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    # unwind: simulate the `git revert --no-commit` — @inmem never executes
    # scripts — by reverting the working tree to the start commit ourselves.
    Given the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds
    Given I mark the current commit as "tip"
    When I run gtd with args "abandon"
    Then it succeeds
    And the git ref "refs/worktree/gtd/history" exists

  Scenario: a no-op success when no process is underway — nothing to abandon
    Given I record the commit count
    When I run gtd with args "abandon"
    Then it succeeds
    And stdout contains "nothing to abandon"
    And the commit count is unchanged
    And the last commit subject is "chore: init gtd workflow"

  Scenario: abandons a gtd review process — the checkout window closes and the reviewed branch tip is restored
    Given I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "--entry review-gate.check --var reviewBase=base"
    Then it succeeds
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): review-gate.check → build.review.reviewing"
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calc.ts

      - [ ] ./src/calc.ts#1
      new export
      """
    When I run gtd land
    Then it succeeds
    # await-review declares `reviewWindow: true`, so the window is open here.
    And the git ref "refs/worktree/gtd/review-head" exists
    When I run gtd with args "abandon"
    Then it succeeds
    # The window closed first, so the rewind starts from the REAL head — the
    # reviewed branch tip is restored, not the review base.
    And the git ref "refs/worktree/gtd/review-head" does not exist
    And the git ref "refs/worktree/gtd/review-base" does not exist
    And the last commit subject is "feat: add calculator"
    And the git status contains ".gtd/REVIEW.md"
    And the git status does not contain "src/calc.ts"

  Scenario: reports the abandoned process and the state it returned to, in plain text
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    When I run gtd with args "abandon"
    Then it succeeds
    And stdout contains "gtd_report_abandoned 'unwind'"
    When I run gtd next
    Then it succeeds
    And stdout contains "State: idle"

  Scenario: the no-op succeeds too, without printing an error
    When I run gtd with args "abandon"
    Then it succeeds
    And stdout contains "nothing to abandon"
    And stderr does not contain "error"

  Scenario: takes no argument
    When I run gtd with args "abandon planning"
    Then it fails
    And stderr contains "gtd abandon: too many arguments"
