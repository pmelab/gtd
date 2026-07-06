@inmem
Feature: Manual steering-file misuse and odd .gtd contents

  Users sometimes fight the workflow by hand — deleting a steering file to
  abandon a loop, or leaving junk in `.gtd/`. These scenarios pin the CURRENT
  behavior: manual deletions land in states no precedence rule matches, and
  gtd hard-errors with the corruption message rather than guessing (the
  recovery policy is an open decision — TODO.md § Open questions). Junk in
  `.gtd/` is ignored gracefully.

  # Abandoning the fix loop by deleting a non-empty FEEDBACK.md leaves HEAD
  # `gtd: errors` with a pending deletion — Testing picks that up. But once
  # the deletion is COMMITTED by hand, the clean `gtd: errors` HEAD matches no
  # rule: corruption, by design (documented, pending a recovery decision).
  Scenario: A hand-committed FEEDBACK.md deletion at gtd: errors is corruption
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: errors" that adds "FEEDBACK.md" with:
      """
      test failure output
      """
    And a commit "gtd: errors" that deletes "FEEDBACK.md"
    When I run gtd
    Then it fails
    And stderr contains "no precedence rule matched"

  Scenario: A hand-committed REVIEW.md deletion at gtd: awaiting review is corruption
    Given a test project
    And a commit "feat: work" that adds "src/work.ts" with:
      """
      export const work = 1
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review
      """
    And a commit "gtd: awaiting review" that deletes "REVIEW.md"
    When I run gtd
    Then it fails
    And stderr contains "no precedence rule matched"

  Scenario: Non-package junk inside .gtd is ignored by the build loop
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/notes.txt" with:
      """
      scratch notes, not a package
      """
    And a commit "gtd: planning" that adds ".gtd/01-real/01-task.md" with:
      """
      Implement the real package.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Build one work package"
    And stdout contains "Implement the real package."
    And stdout does not contain "notes.txt"

  # An empty (untracked) .gtd/ directory under a planning HEAD: gtd must not
  # crash — it resolves Building with no package to offer.
  @live
  Scenario: An empty .gtd directory does not crash the build loop
    Given a test project
    And a gtd config file at "." with:
      """
      testCommand: npm run test
      """
    And a commit "gtd: planning"
    And a directory ".gtd"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Build one work package"
