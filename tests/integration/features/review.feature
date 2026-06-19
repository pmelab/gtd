Feature: Review workflow

  Scenario: gtd <valid-ref> outputs review-create prompt
    Given a test project
    And a commit "feat: add feature" that adds "src/feature.ts" with:
      """
      export const foo = () => "bar"
      """
    When I run gtd with ref "HEAD~1"
    Then it succeeds
    And stdout contains "## Task: Generate REVIEW.md for the current diff"

  Scenario: gtd <invalid-ref> exits with error
    Given a test project
    When I run gtd with ref "nonexistent-ref-xyz"
    Then it fails
    And stderr contains "gtd:"

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

  Scenario: Error when REVIEW.md exists and ref arg provided simultaneously
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234567890abcdef1234 -->

      ## Add foo helper

      - [ ] ./src/foo.ts#1
      """
    And a commit "feat: add another file" that adds "src/other.ts" with:
      """
      export const x = 1
      """
    When I run gtd with ref "HEAD~1"
    Then it fails
    And stderr contains "REVIEW.md already exists"

  Scenario: Checkbox-only REVIEW.md with no text feedback is processed as valid
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
    And stdout contains "# Process Review Feedback"

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

  Scenario: Error when ref arg provided with dirty working tree
    Given a test project
    And a commit "feat: add feature" that adds "src/feature.ts" with:
      """
      export const foo = () => "bar"
      """
    And "src/feature.ts" is modified to:
      """
      export const foo = () => "modified"
      """
    When I run gtd with ref "HEAD~1"
    Then it fails
    And stderr contains "Commit or stash changes"

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

  Scenario: Error when git diff between ref and HEAD is empty (ref is HEAD)
    Given a test project
    When I run gtd with ref "HEAD"
    Then it fails
    And stderr contains "No changes between"
