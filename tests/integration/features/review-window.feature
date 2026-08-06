@inmem
Feature: Review checkout window — the pending review diff surfaces in the editor

  A state may declare `reviewWindow: true` (see STATES.md §11). While the
  workflow RESTS at such a state, gtd rewinds HEAD and the index to the review
  base (the process start, unless a `reviewBase` state narrows it) with the
  working tree untouched, so the whole reviewable diff shows up as ordinary
  uncommitted changes in any editor's standard git integration. The real head
  is preserved under `refs/worktree/gtd/review-head` (the base under
  `refs/worktree/gtd/review-base`) — git's PER-WORKTREE ref namespace, so
  linked worktrees sharing one `.git` each get their own window; every gtd
  invocation restores it BEFORE reading or mutating state, so the pure machine
  never sees the window and the reviewer's own edits are captured by the
  resting state's own `on` patterns like any other pending change. Files added
  since the base surface as ORDINARY UNTRACKED files (see the scenario below);
  the step decision is indifferent, since `changedPaths` unions
  `git ls-files --others` in and reports them as `A` either way.

  The bundled unified workflow declares `reviewWindow: true` on
  `await-review`. Each scenario builds a cycle that rests there: the
  `chore: init gtd workflow` config commit is the process boundary (the diff
  base), two `building` commits carry the reviewable code, and a final
  `await-review` commit carries the committed review doc.

  Background:
    Given a test project
    And the workflow
    And a commit "gtd(agent): building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(agent): building" that adds "src/other.ts" with:
      """
      export const untouched = () => true
      """
    And a commit "gtd(check): await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1 — new add function
      """

  Scenario: Resting at the gate opens the window — HEAD at the base, the diff dirty
    When I run gtd next
    Then it succeeds
    And the git ref "refs/worktree/gtd/review-head" exists
    And the git ref "refs/worktree/gtd/review-base" exists
    # HEAD rests at the review base: the cycle's process boundary.
    And the last commit subject is "chore: init gtd workflow"
    # The whole package diff is visible as uncommitted changes…
    And the git status contains "src/calc.ts"
    And the git status contains "src/other.ts"
    # …while `.gtd/` plumbing stays out of the untracked noise.
    And the git status does not contain "?? .gtd/"

  Scenario: Files added since the base stay untracked — never intent-to-add index entries
    When I run gtd next
    Then it succeeds
    # git's ordinary new-file state, deliberately: an editor's "discard changes"
    # then DELETES the file — the reject-this-file gesture a reviewer means —
    # instead of truncating an intent-to-add entry to zero bytes and leaving a
    # survivor the next `gtd step human` would commit.
    And the git status contains "?? src/calc.ts"
    And the git status contains "?? src/other.ts"
    And the git status does not contain "AM src/calc.ts"

  @live
  Scenario: Real git agrees — the new file is untracked and keeps its content
    When I run gtd next
    Then it succeeds
    And the git status contains "?? src/calc.ts"
    And "src/calc.ts" contains "export const add"

  Scenario: The machine never sees the window — status resolves the real state
    Given I run gtd next
    When I run gtd status
    Then it succeeds
    # `gtd status` closed the window, resolved the true rest, then re-armed it:
    And stdout contains "State: await-review"
    And the git ref "refs/worktree/gtd/review-head" exists
    And the last commit subject is "chore: init gtd workflow"

  Scenario: Deleting the review doc is refused — the window stays open, nothing commits
    Given I run gtd next
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd step human
    Then it fails
    And stderr contains "was deleted"
    # Nothing committed; the window re-arms so the reviewer can restore + tick.
    And the git ref "refs/worktree/gtd/review-head" exists
    And the last commit subject is "chore: init gtd workflow"

  Scenario: Ticking every box with no comment signs off — the window closes and routes to review-deciding
    Given I run gtd next
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1 — new add function
      """
    When I run gtd step human
    Then it succeeds
    # Every box ticked, no note, no code edit — a clean sign-off hands to the
    # deterministic check, which collapses the cycle from there.
    And the last commit subject is "gtd(human): await-review → review-deciding"
    And the git ref "refs/worktree/gtd/review-head" does not exist

  Scenario: Reviewer code edits are feedback — the window closes and routes to review-deciding
    Given I run gtd next
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // reviewer: please rename to sum
      """
    When I run gtd step human
    Then it succeeds
    # A code edit is a comment: it routes to the deterministic review check,
    # which turns it into a build + re-review round.
    And the last commit subject is "gtd(human): await-review → review-deciding"
    And the git ref "refs/worktree/gtd/review-head" does not exist

  Scenario: Read-only commands re-arm the window on their way out
    Given I run gtd next
    When I run gtd status
    Then it succeeds
    And the git ref "refs/worktree/gtd/review-head" exists
    And the last commit subject is "chore: init gtd workflow"
