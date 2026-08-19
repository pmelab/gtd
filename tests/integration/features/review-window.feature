Feature: Review checkout window — the pending review diff surfaces in the editor

  A state may declare `reviewWindow: true` (see STATES.md §11). While the
  workflow RESTS at such a state, HEAD and the index sit at the review base
  (the process start, unless a `reviewBase` state narrows it) with the working
  tree untouched, so the whole reviewable diff shows up as ordinary uncommitted
  changes in any editor's standard git integration. The real head is preserved
  under `refs/worktree/gtd/review-head` (the base under
  `refs/worktree/gtd/review-base`) — git's PER-WORKTREE ref namespace, so
  linked worktrees sharing one `.git` each get their own window. Rest
  resolution READS THROUGH an open window, so the pure machine never sees it
  and the reviewer's own edits are captured by the resting state's own `on`
  patterns like any other pending change. Files added since the base surface as
  ORDINARY UNTRACKED files (see the scenario below); the step decision is
  indifferent, since `changedPaths` unions `git ls-files --others` in and
  reports them as `A` either way.

  The window is WRITE-COMMAND territory, and that is what these scenarios
  exercise. The step that LANDS at the gate opens it (in that command's
  `optional` script — presentation only, which is exactly what the window is);
  the next step AWAY from the gate closes it (in that command's `required`
  script, ahead of its own commit). A read command — `gtd next`, `gtd status` —
  neither opens nor closes it: it resolves through the window and leaves it
  exactly as it found it.

  The bundled unified workflow declares `reviewWindow: true` on
  `await-review`. Each scenario builds a process resting one state earlier, at
  `build.review.reviewing`, with the review doc pending in the working tree:
  the `chore: init gtd workflow` config commit is the process boundary (the
  diff base) and two `building` commits carry the reviewable code, so
  `gtd land` commits the doc, lands at the gate, and opens the window.

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
    And an empty commit "gtd(check): build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """

  @inmem
  Scenario: The step that lands at the gate opens the window — HEAD at the base, the diff dirty
    When I run gtd land
    Then it succeeds
    And the git ref "refs/worktree/gtd/review-head" exists
    And the git ref "refs/worktree/gtd/review-base" exists
    # HEAD rests at the review base: the process boundary.
    And the last commit subject is "chore: init gtd workflow"
    # The whole package diff is visible as uncommitted changes…
    And the git status contains "src/calc.ts"
    And the git status contains "src/other.ts"
    # …while `.gtd/` plumbing stays out of the untracked noise.
    And the git status does not contain "?? .gtd/"

  @inmem
  Scenario: Files added since the base stay untracked — never intent-to-add index entries
    When I run gtd land
    Then it succeeds
    # git's ordinary new-file state, deliberately: an editor's "discard changes"
    # then DELETES the file — the reject-this-file gesture a reviewer means —
    # instead of truncating an intent-to-add entry to zero bytes and leaving a
    # survivor the next `gtd land` would commit.
    And the git status contains "?? src/calc.ts"
    And the git status contains "?? src/other.ts"
    And the git status does not contain "AM src/calc.ts"

  @live
  Scenario: Real git agrees — the new file is untracked and keeps its content
    When I run gtd land
    Then it succeeds
    And the git status contains "?? src/calc.ts"
    And "src/calc.ts" contains "export const add"

  @inmem
  Scenario: The machine never sees the window — status resolves the real state
    Given I run gtd land
    When I run gtd status
    Then it succeeds
    # `gtd status` resolved the true rest by reading THROUGH the open window —
    # it neither closed nor re-armed anything:
    And stdout contains "State: build.review.await-review"
    And the git ref "refs/worktree/gtd/review-head" exists
    And the last commit subject is "chore: init gtd workflow"

  @inmem
  Scenario: Deleting the review doc is refused — the window stays open, nothing commits
    Given I run gtd land
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it fails
    And stderr contains "was deleted"
    # A refusal emits no script at all, so the window stays exactly as it was —
    # the reviewer can restore the file.
    And the git ref "refs/worktree/gtd/review-head" exists
    And the last commit subject is "chore: init gtd workflow"

  @inmem
  Scenario: No comment signs off, boxes ticked along the way or not — the window closes and routes to build.review.deciding
    Given I run gtd land
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function
      """
    When I run gtd land
    Then it succeeds
    # No note, no code edit — a clean sign-off hands to the deterministic
    # check, which collapses the process from there.
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"
    And the git ref "refs/worktree/gtd/review-head" does not exist

  @inmem
  Scenario: Reviewer code edits are feedback — the window closes and routes to build.review.deciding
    Given I run gtd land
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // reviewer: please rename to sum
      """
    When I run gtd land
    Then it succeeds
    # A code edit is a comment: it routes to the deterministic review check,
    # which turns it into a build + re-review round.
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"
    And the git ref "refs/worktree/gtd/review-head" does not exist

  @inmem
  Scenario: Read-only commands leave an open window exactly as they found it
    # Neither command touches git at all now — no close, no re-arm, no reset.
    # The window they resolve through survives both invocations untouched, and
    # the second one still sees exactly what the first did.
    Given I run gtd land
    When I run gtd status
    Then it succeeds
    And the git ref "refs/worktree/gtd/review-head" exists
    And the git ref "refs/worktree/gtd/review-base" exists
    And the last commit subject is "chore: init gtd workflow"
    When I run gtd next
    Then it succeeds
    And the git ref "refs/worktree/gtd/review-head" exists
    And the git ref "refs/worktree/gtd/review-base" exists
    And the last commit subject is "chore: init gtd workflow"
    And the git status contains "src/calc.ts"
