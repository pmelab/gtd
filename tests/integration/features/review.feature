Feature: Review workflow

  Scenario: Modified REVIEW.md with prose but unchecked boxes routes to review-incomplete
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      ## Add foo helper

      Adds the foo helper function.

      - [ ] ./src/foo.ts#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234

      ## Add foo helper

      Adds the foo helper function.
      This looks good, no changes needed.

      - [ ] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Review is incomplete"
    And stdout contains "STOP"
    And stdout does not contain "# Process Review Feedback"

  Scenario: Review process prompt instructs creating TODO.md and deleting REVIEW.md
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      ## Add foo helper

      Adds the foo helper function.

      - [ ] ./src/foo.ts#1
      """
    And a commit "feat: add foo helper" that adds "src/foo.ts" with:
      """
      export function foo() {}
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234

      ## Add foo helper

      Adds the foo helper function.
      Please rename foo to bar everywhere.

      - [x] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "TODO.md"
    And stdout contains "REVIEW.md"

  Scenario: Review process prompt instructs committing TODO.md and REVIEW.md deletion together
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      ## Add foo helper

      Adds the foo helper function.

      - [ ] ./src/foo.ts#1
      """
    And a commit "feat: add foo helper" that adds "src/foo.ts" with:
      """
      export function foo() {}
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234

      ## Add foo helper

      Adds the foo helper function.
      Please rename foo to bar everywhere.

      - [x] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"

  Scenario: Review process prompt instructs recording raw feedback before reset
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      ## Add foo helper

      Adds the foo helper function.

      - [ ] ./src/foo.ts#1
      """
    And a commit "feat: add foo helper" that adds "src/foo.ts" with:
      """
      export function foo() {}
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234

      ## Add foo helper

      Adds the foo helper function.
      Please rename foo to bar everywhere.

      - [x] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"

  Scenario: Ticking all checkboxes with no other changes routes to close-review
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
    When I run gtd
    Then it succeeds
    And the git log contains "chore(gtd): close approved review for"
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"
    And stdout does not contain "## Task: Close the approved review"
    And stdout does not contain "# Process Review Feedback"

  Scenario: Un-ticking a checkbox routes to review-incomplete, not close-review
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      ## Add foo helper

      - [x] ./src/foo.ts#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234

      ## Add foo helper

      - [ ] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Review is incomplete"
    And stdout contains "STOP"
    And stdout does not contain "# Process Review Feedback"
    And stdout does not contain "## Task: Close the approved review"

  Scenario: Ticking a checkbox plus adding prose routes to review-process, not close-review
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      ## Add foo helper

      - [ ] ./src/foo.ts#1
      """
    And a commit "feat: add foo helper" that adds "src/foo.ts" with:
      """
      export function foo() {}
      """
    And "REVIEW.md" is modified to:
      """
      # Review: abc1234

      ## Add foo helper

      Please rename foo to bar.

      - [x] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout does not contain "## Task: Close the approved review"

  Scenario: Ticking a checkbox plus a source-file edit routes to review-process
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      ## Add foo helper

      - [ ] ./src/foo.ts#1
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
      """
    And a file "src/scratch.ts" with:
      """
      // scratch notes from review session
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout does not contain "## Task: Commit the uncommitted changes"

  Scenario: Note plus dirty source with unchecked boxes routes to review-incomplete
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

      Looks good so far.

      - [ ] ./src/foo.ts#1
      """
    And a file "src/scratch.ts" with:
      """
      // scratch notes from review session
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Review is incomplete"
    And stdout contains "STOP"
    And stdout does not contain "## Task: Commit the uncommitted changes"

  Scenario: Untracked files added during review with unchecked boxes route to review-incomplete
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

      Reviewer added a scratch file for context.

      - [ ] ./src/foo.ts#1
      """
    And a file "src/scratch.ts" with:
      """
      // scratch notes from review session
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Review is incomplete"
    And stdout contains "STOP"
    And stdout does not contain "## Task: Commit the uncommitted changes"

  Scenario: An unmodified committed REVIEW.md is the review gate
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      ## Add foo helper

      - [ ] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "Wait for the human to review"
    And stdout contains "STOP"
    And stdout does not contain "Re-run gtd immediately"

  Scenario: After closing, the next run reports verified, not a fresh review
    Given a test project
    And a commit "feat(gtd): add foo helper" that adds "src/foo.ts" with:
      """
      export function foo() {}
      """
    And a commit "chore(gtd): close approved review for abc1234" that adds "CLOSE.md" with:
      """
      Approved.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "working tree healthy and fully reviewed"
    And stdout does not contain "Generate REVIEW.md after successful verification"

  Scenario: Closing reports verified even when a prior review commit exists as a fallback base
    # Regression: with an earlier `review(gtd): create review for ...` commit in
    # history, computeReviewBase would otherwise fall back to it once the close
    # commit (HEAD) is filtered out, and diff that prior commit against HEAD —
    # re-surfacing the close commit's changes as a fresh review and looping
    # forever. The frontier-at-HEAD short-circuit must win: HEAD is a close
    # commit, so nothing is left to review.
    Given a test project
    And a commit "feat(gtd): add foo helper" that adds "src/foo.ts" with:
      """
      export function foo() {}
      """
    And a prior review commit for "abc1234"
    And a commit "chore(gtd): close approved review for abc1234" that adds "CLOSE.md" with:
      """
      Approved.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "working tree healthy and fully reviewed"
    And stdout does not contain "Generate REVIEW.md after successful verification"
