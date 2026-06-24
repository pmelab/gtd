# Markerless feedback rule: ANY working-tree change during review (beyond
# box-ticks) is feedback and routes to review-process. There is no special
# `!!` marker — a `// !!` line is ordinary source feedback, indistinct from
# any other code or comment change.

Feature: Any working-tree change during review is feedback (markerless)

  Scenario: A REVIEW.md prose note routes to review-process
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      - [ ] ./src/foo.ts#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      Please rename foo to bar everywhere.

      - [x] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout does not contain "## Task: Close the approved review"

  Scenario: A plain source-file edit routes to review-process
    Given a test project
    And a commit "feat: app" that adds "src/app.ts" with:
      """
      export const app = () => 1
      """
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## App

      - [ ] ./src/app.ts#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## App

      - [x] ./src/app.ts#1
      """
    And "src/app.ts" is modified to:
      """
      export const app = () => 2
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout does not contain "## Task: Close the approved review"

  Scenario: A `// !!` comment is ordinary feedback, not a special divert
    Given a test project
    And a commit "feat: app" that adds "src/app.ts" with:
      """
      export const app = () => 1
      """
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## App

      - [ ] ./src/app.ts#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## App

      - [x] ./src/app.ts#1
      """
    And "src/app.ts" is modified to:
      """
      export const app = () => 1
      // !! handle the empty-input edge case
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout does not contain "## Task: Close the approved review"

  Scenario: All boxes ticked with no other changes routes to close-review
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
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Close the approved review"
    And stdout does not contain "# Process Review Feedback"
