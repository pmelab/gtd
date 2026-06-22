Feature: Review workflow

  Scenario: Modified REVIEW.md triggers review-process branch
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      Adds the foo helper function.

      - [ ] ./src/foo.ts#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      Adds the foo helper function.
      This looks good, no changes needed.

      - [ ] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"

  Scenario: Review process prompt instructs creating TODO.md and deleting REVIEW.md
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      Adds the foo helper function.

      - [ ] ./src/foo.ts#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      Adds the foo helper function.
      Please rename foo to bar everywhere.

      - [ ] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "TODO.md"
    And stdout contains "REVIEW.md"
    And stdout contains "git checkout -- ."

  Scenario: Review process prompt instructs committing TODO.md and REVIEW.md deletion together
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      Adds the foo helper function.

      - [ ] ./src/foo.ts#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      Adds the foo helper function.
      Please rename foo to bar everywhere.

      - [ ] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "docs(review): process review feedback into TODO.md"

  Scenario: Ticking all checkboxes with no other changes routes to close-review
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
    And stdout contains "chore(gtd): close approved review"
    And stdout does not contain "# Process Review Feedback"

  Scenario: Un-ticking a checkbox routes to review-process, not close-review
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      - [x] ./src/foo.ts#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      - [ ] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout does not contain "chore(gtd): close approved review"

  Scenario: Ticking a checkbox plus adding prose routes to review-process, not close-review
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

      Please rename foo to bar.

      - [x] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout does not contain "chore(gtd): close approved review"

  Scenario: Ticking a checkbox plus a source-file edit routes to review-process, not close-review
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

      - [x] ./src/foo.ts#1
      """
    And a file "src/scratch.ts" with:
      """
      // scratch notes from review session
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout does not contain "chore(gtd): close approved review"

  Scenario: Error when base comment is missing from REVIEW.md
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      ## Add foo helper

      - [ ] ./src/foo.ts#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234

      ## Add foo helper

      Please rename this.

      - [x] ./src/foo.ts#1
      """
    When I run gtd
    Then it fails
    And stderr contains "missing base ref"

  Scenario: Untracked files created during review are cleaned up by review-process prompt
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

      Reviewer added a scratch file for context.

      - [ ] ./src/foo.ts#1
      """
    And a file "src/scratch.ts" with:
      """
      // scratch notes from review session
      """
    When I run gtd
    Then it succeeds
    And stdout contains "git clean -fd"

  Scenario: Error when REVIEW.md exists but has not been modified
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      - [ ] ./src/foo.ts#1
      """
    When I run gtd
    Then it fails
    And stderr contains "REVIEW.md exists but has no changes"
