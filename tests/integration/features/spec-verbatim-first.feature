# Aspirational — covers example.md Rule 1 ("Verbatim first") and Rule 9's
# git add -A scope. Every invocation begins by committing whatever the human
# changed, verbatim, BEFORE any gate is evaluated. Allowed to fail.

Feature: Human changes are committed verbatim before any gate is evaluated

  Scenario: Uncommitted human changes are committed verbatim first
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
    And stdout contains "## Task: Commit the uncommitted changes"

  Scenario: Commit uses git add -A so untracked files are captured too
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
    And stdout contains "## Task: Commit the uncommitted changes"
    And stdout contains "git add -A"

  Scenario: Review gate routes human edits to review-process when REVIEW.md is present and all boxes ticked
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      - [ ] ./src/foo.ts#1
      - [ ] ./src/bar.ts#5
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

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
