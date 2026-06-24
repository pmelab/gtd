# Aspirational — covers example.md Rule 9 `!!` comment harvesting. Leftover
# `!!` comments (a comment whose body begins with `!!`, in any language) are
# consolidated verbatim into a new TODO.md. Only `!!` on lines ADDED since the
# `review(gtd): create review …` commit are harvested (reviewer-added work);
# pre-existing `!!` are ignored. Harvest is read-only. The reviewer's source
# edits reach review-process already committed (code-changes runs first), so
# the `!!` is captured into TODO.md but stays in source history — it is not
# auto-stripped. Intent is not parsed. Plain `TODO:` markers are never
# harvested. Allowed to fail.

Feature: `!!` comments are harvested into TODO.md; `TODO:` markers are not

  Scenario: A checked review plus a `!!` comment loops and harvests the comment
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
    And a commit "fix: app edge case" that adds "src/app.ts" with:
      """
      export const app = () => 1
      // !! handle the empty-input edge case
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
      """
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Script

      - [x] ./scripts/run.py#1
      """
    And a commit "fix: validate config" that adds "scripts/run.py" with:
      """
      def run():
          return 1
      # !! validate the config before running
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
      """
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## App

      - [ ] ./src/app.ts#1
      """
    And a commit "fix: rounding" that adds "src/app.ts" with:
      """
      export const app = () => 1
      // !! this is probably fine but double-check the rounding
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

  Scenario: Unreferenced reviewer-added `!!` IS harvested
    Given a test project
    And a commit "feat: app" that adds "src/app.ts" with:
      """
      export const app = () => 1
      """
    And a commit "feat: other" that adds "src/other.ts" with:
      """
      export const other = () => 2
      """
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## App

      - [ ] ./src/app.ts#1
      """
    And a commit "fix: other" that adds "src/other.ts" with:
      """
      export const other = () => 2
      // !! xyzzy-sentinel-unreferenced-scope-check
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## App

      - [x] ./src/app.ts#1
      """
    When I run gtd
    # src/other.ts is NOT in REVIEW.md's chunk refs, but the `!!` was added
    # after the review-create commit so it IS in the working-tree diff and
    # therefore IS harvested under the new added-line semantics.
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout contains "xyzzy-sentinel-unreferenced-scope-check"

  Scenario: A `!!` committed at/before the review commit is NOT harvested
    Given a test project
    And a commit "feat: app" that adds "src/app.ts" with:
      """
      export const app = () => 1
      // !! xyzzy-sentinel-pre-review-commit
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
    # The `!!` was committed BEFORE the review-create commit, so it is NOT a
    # new added line in the working-tree diff since that commit. Only the
    # REVIEW.md forward-tick is new, so this routes to close-review.
    Then it succeeds
    And stdout contains "## Task: Close the approved review"
    And stdout does not contain "xyzzy-sentinel-pre-review-commit"

  Scenario: A plain `TODO:` marker is ordinary code and does not block conclusion
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
    And a commit "chore: note" that adds "src/app.ts" with:
      """
      export const app = () => 1
      // TODO: maybe optimize this later
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
