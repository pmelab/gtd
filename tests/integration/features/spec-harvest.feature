# `!!` on lines added since the review-create commit divert an otherwise-approved
# review into `review-process` (boolean `bangPresent`); the prompt instructs the
# agent to read the commit-"x" diff and `git revert` it, leaving NO `!!` artifact;
# per-comment text is no longer surfaced.

Feature: `!!` comments are harvested into TODO.md; `TODO:` markers are not

  Scenario: routes to review-process
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
    And stdout contains "git revert --no-edit"
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

  Scenario: Unreferenced reviewer-added `!!` still diverts to review-process
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
