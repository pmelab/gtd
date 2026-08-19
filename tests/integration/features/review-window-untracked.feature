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

  Without that, the review-doc guard (`src/StepGuards.ts`) saw a phantom
  `D <reviewFile>` and refused EVERY sign-off with "was deleted — restore it",
  with the file sitting untouched in the working tree. The bundled
  `.gtd/REVIEW.md` hid it: `.gtd` is the one directory the window pins back
  into the index (`buildOpenWindowScript`'s `restoreStagedFrom`), so the doc
  stays TRACKED there. A `reviewFile` repointed to the repo root — an ordinary
  `vars:` override — is not pinned, and so was unlandable.

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
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        reviewFile: REVIEW.md
      """
    And a commit "gtd(agent): building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And an empty commit "gtd(check): build.review.reviewing"
    And a file "REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """

  Scenario: the review doc the window left untracked is not pending at all — it is present and unchanged
    # The step that lands at the gate commits REVIEW.md and opens the window,
    # which un-tracks it again (the index moves to the review base).
    Given I run gtd land
    When I run gtd status
    Then it succeeds
    And stdout contains "State: build.review.await-review"
    # Present on disk with the bytes it was committed with: no change, and
    # above all not a deletion.
    And stdout does not contain "D REVIEW.md"
    And the git status contains "?? REVIEW.md"

  Scenario: a tick with no comment signs off — the reviewer's edit reads as a modification
    Given I run gtd land
    And "REVIEW.md" is modified to:
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
    And the file "REVIEW.md" is deleted
    When I run gtd land
    Then it fails
    And stderr contains "was deleted"
    # A refusal emits no script, so the window stays open for the reviewer to
    # restore the file.
    And the git ref "refs/worktree/gtd/review-head" exists
