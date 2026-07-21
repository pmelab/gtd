@inmem
Feature: Review checkout window — the pending review diff surfaces in the editor

  While the workflow rests at the human review gate (`gtd: await-review`),
  gtd rewinds HEAD and the index to the review base with the working tree
  untouched, so the whole reviewable diff shows up as ordinary uncommitted
  changes in any editor's standard git integration. The real head is preserved
  under `refs/gtd/review-head` (the base under `refs/gtd/review-base`); every
  gtd invocation restores it before reading or mutating state, so the machine
  never sees the window and the reviewer's own edits are captured as their own
  separate `gtd(human): review` feedback commit — never mixed into the
  reviewed package commits.

  Background:
    Given a test project
    And a commit "chore: add config" that adds ".gtdrc" with:
      """
      testCommand: "true"
      agenticReview: false
      squash: false
      learning: false
      """
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Implement a calculator.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd(agent): building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(agent): building" that adds "src/other.ts" with:
      """
      export const untouched = () => true
      """
    And a commit "gtd: close-package"
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1 — new add function
      """
    And a commit "gtd: await-review"

  Scenario: Resting at the gate opens the window — HEAD at the base, the diff dirty
    When I run gtd next
    Then it succeeds
    And the git ref "refs/gtd/review-head" exists
    And the git ref "refs/gtd/review-base" exists
    # HEAD rests at the review base: the cycle's first grilling turn.
    And the last commit subject is "gtd(human): grilling"
    # The real head is intact behind the ref.
    And the git log at "refs/gtd/review-head" contains "gtd: await-review"
    # The whole package diff is visible as uncommitted changes…
    And the git status contains "src/calc.ts"
    And the git status contains "src/other.ts"
    # …while `.gtd/` plumbing stays out of the unstaged noise.
    And the git status does not contain "?? .gtd/"

  Scenario: An empty step approves — the window closes and leaves no trace
    Given I run gtd next
    When I run gtd step
    Then it succeeds
    And the git log contains "gtd(human): review"
    And the last commit subject is "gtd: done"
    And the git ref "refs/gtd/review-head" does not exist
    And the git ref "refs/gtd/review-base" does not exist
    And the file ".gtd/REVIEW.md" does not exist

  Scenario: Reviewer edits land as their own separate feedback commit
    Given I run gtd next
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // reviewer: please rename to sum
      """
    When I run gtd step
    Then it succeeds
    And the git log contains "gtd(human): review"
    And the last commit subject is "gtd: grilling"
    And the git ref "refs/gtd/review-head" does not exist
    # The re-grill prompt inlines exactly the reviewer's edit — the untouched
    # package file is absent, proving the feedback commit carries only the
    # reviewer's own change, not the rewound package diff.
    When I run gtd next
    Then it succeeds
    And stdout contains "reviewer: please rename to sum"
    And stdout does not contain "src/other.ts"

  Scenario: Deleting a surfaced file (editor "discard") is reversion feedback
    Given I run gtd next
    And the file "src/calc.ts" is deleted
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    When I run gtd next
    Then it succeeds
    And stdout contains "src/calc.ts"

  Scenario: Read-only commands re-arm the window on their way out
    Given I run gtd next
    When I run gtd status
    Then it succeeds
    And the git ref "refs/gtd/review-head" exists
    And the last commit subject is "gtd(human): grilling"
    When I run gtd next
    Then it succeeds
    And the git ref "refs/gtd/review-head" exists
    And the last commit subject is "gtd(human): grilling"

  Scenario: gtd next with pending reviewer edits refuses but keeps the window armed
    Given I run gtd next
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // half-finished review note
      """
    When I run gtd next
    Then it fails
    # Re-armed on the error path: the editor keeps showing the diff and the
    # reviewer's pending edit survives in the working tree.
    And the git ref "refs/gtd/review-head" exists
    And the last commit subject is "gtd(human): grilling"
    And the file "src/calc.ts" contains "half-finished review note"

  Scenario: gtd step-agent at the human gate refuses and re-arms the window
    Given I run gtd next
    When I run gtd step-agent
    Then it fails
    And stderr contains "await-review awaits a human turn"
    And the git ref "refs/gtd/review-head" exists
    And the last commit subject is "gtd(human): grilling"

  Scenario: A crash between the ref writes and the rewind recovers cleanly
    Given the git ref "refs/gtd/review-base" points at "HEAD~6"
    And the git ref "refs/gtd/review-head" points at "HEAD"
    When I run gtd status
    Then it succeeds
    And stdout contains "await-review"
    # The stale window was closed and a fresh one re-armed.
    And the git ref "refs/gtd/review-head" exists
    And the last commit subject is "gtd(human): grilling"

  Scenario: A manual commit during the window becomes feedback; its message is discarded
    Given I run gtd next
    And a commit "wip: reviewer tweak" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      // tweak made in a manual commit
      """
    When I run gtd step
    Then it succeeds
    And the git log does not contain "wip: reviewer tweak"
    And the last commit subject is "gtd: grilling"
    When I run gtd next
    Then it succeeds
    And stdout contains "tweak made in a manual commit"

  Scenario: Leaving the reviewed branch refuses loudly and keeps the refs
    Given I run gtd next
    And HEAD is soft-reset to "HEAD~1"
    When I run gtd status
    Then it fails
    And stderr contains "review checkout window"
    And the git ref "refs/gtd/review-head" exists
    And the git ref "refs/gtd/review-base" exists

  @live
  Scenario: Live tier — the window opens, surfaces the diff, and closes on approval
    When I run gtd next
    Then it succeeds
    And the git ref "refs/gtd/review-head" exists
    And the last commit subject is "gtd(human): grilling"
    And the git log at "refs/gtd/review-head" contains "gtd: await-review"
    And the git status contains "src/calc.ts"
    When I run gtd step
    Then it succeeds
    And the git log contains "gtd(human): review"
    And the last commit subject is "gtd: done"
    And the git ref "refs/gtd/review-head" does not exist
    And the git status is clean
