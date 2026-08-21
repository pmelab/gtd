@live
Feature: An open review window reports untracked-but-present files by content, never as deletions

  The review checkout window rewinds HEAD and the INDEX to the review base
  (`git reset --mixed`) and leaves the working tree untouched, so every file the
  reviewed range ADDED sits on disk while being absent from the index — git's
  ordinary untracked state, deliberately (see review-window.feature). Pending
  changes are measured against the window's saved head, and
  `git diff --name-status <saved-head>` compares that commit to the INDEX: it
  therefore reports each of those files DELETED, though they are right there on
  disk. `changedPaths` classifies untracked paths by CONTENT instead (see
  `src/Git.ts`) — absent at the base is `A`, different bytes are `M`, identical
  bytes are no change at all.

  Every steering file now lives at a fixed path under `.gtd/`, and `.gtd` is
  the one directory the window pins back into the index
  (`buildOpenWindowScript`'s `restoreStagedFrom`), so `.gtd/REVIEW.md` itself
  can no longer demonstrate the phantom-deletion bug (it stays TRACKED
  through the window). This exercises the same `classifyUntracked` content
  comparison against an ordinary CODE file instead — any file the process
  added earlier stays untracked once the window opens (it lives outside
  `.gtd/`, same as before), and its content on disk is unchanged since the
  commit that saved the window's head.

  Every scenario here is live, because the phantom deletion is real git's index
  behaviour: the in-memory double compares the base tree to the worktree
  directly and has always answered by content
  (`InMemRepo.changedPathsWorktree`), so an @inmem scenario cannot fail on this.
  The contract test that pins the two tiers together on it lives in
  `src/testing/GitTiers.ts`.

  Coverage gap: the review-doc guard's `fileDeleted` branch is the only thing
  it checks now, and deciding that needs no `head` read at all — so the
  deletion scenario below no longer exercises `GuardContext.head`'s
  `windowHead` read. That read's production plumbing is untouched (kept for a
  future guard, see `src/StepGuards.ts`), but this file's tick-completeness
  scenario was its only regression coverage, and it is gone along with the
  guard's tick check. No in-memory scenario can replace it either — the
  in-memory double never had the phantom-deletion behaviour this file exists
  for.

  Background:
    Given a test project
    And the workflow
    And a commit "gtd(agent): building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
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

  Scenario: a code file the window left untracked is not pending at all — it is present and unchanged
    # The step that lands at the gate commits REVIEW.md and opens the window,
    # which rewinds the index to the review base — src/calc.ts (added earlier
    # in the process, outside .gtd/) goes untracked again, same bytes as the
    # window's saved head.
    Given I run gtd land
    When I run gtd next
    Then it succeeds
    And stdout contains "State: build.review.await-review"
    # Present on disk with the bytes the window's head committed: no change,
    # and above all not a deletion.
    And stdout does not contain "D src/calc.ts"
    And the git status contains "?? src/calc.ts"

  Scenario: a tick with no comment signs off — the reviewer's edit reads as a modification
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
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"
    And the git ref "refs/worktree/gtd/review-head" does not exist

  Scenario: a REAL deletion is still refused — the guard keeps its teeth through real git
    Given I run gtd land
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it fails
    And stderr contains "was deleted"
    # A refusal emits no script, so the window stays open for the reviewer to
    # restore the file.
    And the git ref "refs/worktree/gtd/review-head" exists
