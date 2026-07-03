@inmem
Feature: Close package — one gtd: package done per package

  An approved (empty FEEDBACK.md) package is closed: the FEEDBACK.md and the
  finished package directory are removed and the result committed
  `gtd: package done`. If packages remain, the loop advances to Building the next
  one; if it was the last, the now-empty `.gtd/` is removed too and the loop
  advances to Clean.

  Scenario: Closing the first of two packages advances to building the next
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the first helper.
      """
    And a commit "gtd: planning" that adds ".gtd/02-bar/01-task.md" with:
      """
      Implement the second helper.
      """
    And an empty file "FEEDBACK.md"
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: package done"
    And the file ".gtd/01-foo/01-task.md" does not exist
    And the file ".gtd/02-bar/01-task.md" exists
    And stdout contains "## Task: Build one work package"
    And stdout contains "Implement the second helper."

  Scenario: Closing the last package removes .gtd and advances to Clean
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] implement the only helper
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the only helper.
      """
    And a commit "gtd: building" that adds "src/helper.ts" with:
      """
      export const helper = () => 42
      """
    And an empty file "FEEDBACK.md"
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: package done"
    And the file ".gtd" does not exist
    # The review spans the whole task (base = first gtd: grilling) but the
    # workflow-file churn (TODO.md, .gtd/) is filtered out of the diff.
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
    And stdout contains "src/helper.ts"
    And stdout does not contain "a/.gtd/01-foo/01-task.md"
