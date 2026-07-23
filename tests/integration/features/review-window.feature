@inmem
Feature: Review checkout window — the pending review diff surfaces in the editor

  A state may declare `reviewWindow: true` (see STATES.md §11). While the
  workflow RESTS at such a state, gtd rewinds HEAD and the index to the review
  base (the process start, unless a `reviewBase` state narrows it) with the
  working tree untouched, so the whole reviewable diff shows up as ordinary
  uncommitted changes in any editor's standard git integration. The real head
  is preserved under `refs/gtd/review-head` (the base under
  `refs/gtd/review-base`); every gtd invocation restores it BEFORE reading or
  mutating state, so the pure machine never sees the window and the reviewer's
  own edits are captured by the resting state's own `on` patterns like any
  other pending change.

  The bundled default declares `reviewWindow: true` on `await-review`. Each
  scenario builds a cycle that rests there: `chore: initial commit` is the
  process boundary (the diff base), two `building` commits carry the reviewable
  code, and a final `await-review` commit carries the committed review doc.

  Background:
    Given a test project
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
    And the git ref "refs/gtd/review-head" exists
    And the git ref "refs/gtd/review-base" exists
    # HEAD rests at the review base: the cycle's process boundary.
    And the last commit subject is "chore: initial commit"
    # The whole package diff is visible as uncommitted changes…
    And the git status contains "src/calc.ts"
    And the git status contains "src/other.ts"
    # …while `.gtd/` plumbing stays out of the untracked noise.
    And the git status does not contain "?? .gtd/"

  Scenario: The machine never sees the window — status resolves the real state
    Given I run gtd next
    When I run gtd status
    Then it succeeds
    # `gtd status` closed the window, resolved the true rest, then re-armed it:
    And stdout contains "State: await-review"
    And the git ref "refs/gtd/review-head" exists
    And the last commit subject is "chore: initial commit"

  Scenario: Deleting the review doc approves — the window closes and leaves no trace
    Given I run gtd next
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle"
    And the git ref "refs/gtd/review-head" does not exist
    And the git ref "refs/gtd/review-base" does not exist
    And ".gtd/REVIEW.md" does not exist

  Scenario: Reviewer code edits close the window and route back as feedback
    Given I run gtd next
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // reviewer: please rename to sum
      """
    When I run gtd step human
    Then it succeeds
    # A code edit with REVIEW.md untouched is feedback straight to grilling.
    And the last commit subject is "gtd(human): grilling"
    And the git ref "refs/gtd/review-head" does not exist

  Scenario: Read-only commands re-arm the window on their way out
    Given I run gtd next
    When I run gtd status
    Then it succeeds
    And the git ref "refs/gtd/review-head" exists
    And the last commit subject is "chore: initial commit"
