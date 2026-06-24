# Aspirational — covers example.md Rule 8 (review) and Rule 9 (conclude vs loop).
# REVIEW.md covers the diff since the last REVIEW.md was removed (the baseline)
# and gates until every box is checked. Once all boxes are checked, gtd scans
# for leftover work since the baseline (REVIEW.md notes, `!!` comments, human
# code changes): none -> conclude; any -> consolidate into a new TODO.md and
# loop. Allowed to fail.

Feature: Review gate and the conclude-vs-loop decision

  Scenario: Review generation covers the diff since the baseline
    Given a test project
    And a default branch "feature"
    And a prior review commit for "prev1234"
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a commit "feat: add parser" that adds "src/parser.ts" with:
      """
      export const parse = (s: string) => JSON.parse(s)
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Generate REVIEW.md"
    And stdout contains "src/parser.ts"

  Scenario: All boxes checked with no leftover work concludes by removing REVIEW.md
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
    And the last commit subject is "chore(gtd): close approved review for abc1234"
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"
    And stdout does not contain "## Task: Close the approved review"
    And stdout does not contain "# Process Review Feedback"

  Scenario: All boxes checked but a leftover note loops into a new TODO.md
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

      Please also rename foo to bar everywhere.

      - [x] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout contains "TODO.md"
    And stdout does not contain "## Task: Close the approved review"

  Scenario: All boxes checked but a human source edit loops instead of concluding
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
    And a file "src/foo.ts" with:
      """
      export const foo = () => 2
      """
    When I run gtd
    Then it succeeds
    And stdout contains "# Process Review Feedback"
    And stdout does not contain "## Task: Close the approved review"

  Scenario: Unchecked boxes route to review-incomplete, not review-process or close-review
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

      Looks promising so far.

      - [x] ./src/foo.ts#1
      - [ ] ./src/bar.ts#5
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Review is incomplete"
    And stdout contains "STOP"
    And stdout does not contain "# Process Review Feedback"
    And stdout does not contain "## Task: Close the approved review"

  Scenario: A consolidated TODO.md is re-grilled; a small one is marked simple
    Given a test project
    And a commit "docs(review): process review feedback into TODO.md" that adds "TODO.md" with:
      """
      - rename foo to bar in src/foo.ts
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Develop the plan in `TODO.md`"
