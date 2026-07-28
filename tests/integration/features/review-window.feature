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
    And the git ref "refs/gtd/review-head" exists
    And the git ref "refs/gtd/review-base" exists
    # HEAD rests at the review base: the cycle's process boundary.
    And the last commit subject is "chore: init gtd workflow"
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
    And the last commit subject is "chore: init gtd workflow"

  Scenario: Deleting the review doc signs off — the window closes and routes to the squash finale
    Given I run gtd next
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): await-review → squashing"
    And the git ref "refs/gtd/review-head" does not exist
    And the git ref "refs/gtd/review-base" does not exist
    And ".gtd/REVIEW.md" does not exist

  Scenario: Reviewer code edits close the window and route to a re-test + re-review
    Given I run gtd next
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // reviewer: please rename to sum
      """
    When I run gtd step human
    Then it succeeds
    # A code edit with REVIEW.md untouched re-runs the tests on the manual fix
    # and re-reviews it (checking).
    And the last commit subject is "gtd(human): await-review → checking"
    And the git ref "refs/gtd/review-head" does not exist

  Scenario: Read-only commands re-arm the window on their way out
    Given I run gtd next
    When I run gtd status
    Then it succeeds
    And the git ref "refs/gtd/review-head" exists
    And the last commit subject is "chore: init gtd workflow"
