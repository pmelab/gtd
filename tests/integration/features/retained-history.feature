@inmem
Feature: gtd restore — undo an abandon by hard-resetting to the retained tip

  `gtd abandon` rewinds a process still underway, retaining the pre-abandon
  tip on `refs/worktree/gtd/history` (see `src/RetainedHistory.ts`) before it
  acts — its only writer; `gtd land` never moves HEAD, so it never touches
  this ref. `gtd restore` is the way back: it hard-resets HEAD to the
  retained tip and clears the ref — purely `abandon`'s inverse.

  It is guarded by `restorability` so it never discards work it didn't
  create: it refuses on a dirty working tree, when there is no retained
  history to restore, and when HEAD has moved past the retained tip with
  commits that would be lost by resetting back to it.

  Background:
    Given a test project
    And the workflow

  Scenario: refuses when there is no retained history to restore
    When I run gtd with args "restore"
    Then it fails
    And stderr contains "gtd restore: no retained history to restore."

  Scenario: refuses on a dirty working tree, even with retained history available
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"
    # Abandon here, still resting AT unwind, before its own script lands: past
    # that point NOTE.md would already be gone from the tree, with nothing
    # left to leave dirty.
    When I run gtd with args "abandon"
    Then it succeeds
    And the git ref "refs/worktree/gtd/history" exists
    # The abandon left "NOTE.md" as an uncommitted pending change — the
    # tree is dirty, so restore refuses before it even looks at the ref.
    When I run gtd with args "restore"
    Then it fails
    And stderr contains "gtd restore: refuses on a dirty working tree"

  Scenario: cleaned-abandon safety case — restore succeeds when HEAD is an ancestor of the retained tip
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

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"

    When I run gtd with args "abandon"
    Then it succeeds
    And the git ref "refs/worktree/gtd/history" exists
    And the last commit subject is "chore: init gtd workflow"

    # Past the unwind, the abandon leaves nothing pending at all — NOTE.md is
    # already gone from the tree — so restore's dirty-tree guard never fires.
    When I run gtd with args "restore"
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"
    And the git ref "refs/worktree/gtd/history" does not exist

  Scenario: reports the restored state via the emitted script, in plain text
    # No --json here (restore is plain-text only, see AGENTS.md) — the
    # printed script's own gtd_report_restored call names the state it
    # restored to.
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

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"

    # Past the unwind, abandon leaves nothing pending at all, so restore's
    # dirty-tree guard never fires.
    When I run gtd with args "abandon"
    Then it succeeds

    When I run gtd with args "restore"
    Then it succeeds
    And stdout contains "gtd_report_restored"
    And stdout contains "'design.triage'"

  Scenario: reports the standard error on stderr, leaving stdout empty
    When I run gtd with args "restore"
    Then it fails
    And stdout is empty
    And stderr contains "no retained history to restore"

  Scenario: takes no positional argument
    When I run gtd with args "restore foo"
    Then it fails
    And stderr contains "gtd restore: too many arguments"
