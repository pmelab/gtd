# Aspirational — covers example.md Rule 9 `!!` comment harvesting. Leftover
# `!!` comments (a comment whose body begins with `!!`, in any language) are
# consolidated verbatim into a new TODO.md and then stripped from the code.
# Intent is not parsed. Plain `TODO:` markers are ordinary code and are never
# harvested. Allowed to fail.

Feature: `!!` comments are harvested into TODO.md; `TODO:` markers are not

  Scenario: A checked review plus a `!!` comment loops and harvests the comment
    Given a test project
    And a commit "feat: app" that adds "src/app.ts" with:
      """
      export const app = () => 1
      // !! handle the empty-input edge case
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
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout contains "handle the empty-input edge case"
    And stdout contains "TODO.md"
    And stdout does not contain "## Task: Close the approved review"

  Scenario: The `!!` marker is recognized regardless of comment syntax
    Given a test project
    And a commit "feat: script" that adds "scripts/run.py" with:
      """
      def run():
          return 1
      # !! validate the config before running
      """
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Script

      - [x] ./scripts/run.py#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Script

      - [x] ./scripts/run.py#1

      <!-- reviewer ticked everything -->
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout contains "validate the config before running"

  Scenario: Harvesting captures the `!!` text verbatim without parsing intent
    Given a test project
    And a commit "feat: app" that adds "src/app.ts" with:
      """
      export const app = () => 1
      // !! this is probably fine but double-check the rounding
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
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout contains "this is probably fine but double-check the rounding"

  Scenario: A plain `TODO:` marker is ordinary code and does not block conclusion
    Given a test project
    And a commit "feat: app" that adds "src/app.ts" with:
      """
      export const app = () => 1
      // TODO: maybe optimize this later
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
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Close the approved review"
    And stdout does not contain "# Process Review Feedback"
