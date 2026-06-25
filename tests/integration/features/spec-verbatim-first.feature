# Aspirational — covers example.md Rule 1 ("Verbatim first") and Rule 9's
# git add -A scope. Every invocation begins by committing whatever the human
# changed, verbatim, BEFORE any gate is evaluated. Allowed to fail.

Feature: Human changes are committed verbatim before any gate is evaluated

  Scenario: Uncommitted human changes are committed verbatim first
    # The code-changes edge commits the dirty source BEFORE any gate; one gtd run
    # lands the commit and drives the loop to the next leaf (verified).
    Given a test project
    And a commit "feat: math" that adds "src/math.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And "src/math.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "chore(gtd): commit pending changes"
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"

  Scenario: Commit uses git add -A so untracked files are captured too
    # The untracked file is staged by the edge's `git add -A` and lands in the
    # verbatim commit (proven by the clean tree → verified after one run).
    Given a test project
    And a commit "feat: math" that adds "src/math.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/extra.ts" with:
      """
      export const extra = () => 1
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "chore(gtd): commit pending changes"
    And the file "src/extra.ts" exists
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"

  Scenario: Review gate routes human edits to review-process when REVIEW.md is present and all boxes ticked
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      ## Add foo helper

      - [ ] ./src/foo.ts#1
      - [ ] ./src/bar.ts#5
      """
    And a commit "feat: add foo helper" that adds "src/foo.ts" with:
      """
      export function foo() {}
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234

      ## Add foo helper

      - [x] ./src/foo.ts#1
      - [x] ./src/bar.ts#5
      """
    And a file "src/scratch.ts" with:
      """
      // a fix the human made during review
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout does not contain "## Task: Commit the uncommitted changes"
    And stdout does not contain "## Task: Close the approved review"
