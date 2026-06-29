Feature: Human-review is no longer test-gated

  Part A retires the human-review test gate. The test gate now fires ONLY before
  `execute` (see execute-gate.feature). `human-review` reaches REVIEW.md
  generation directly — a clean tree with an unreviewed diff yields the REVIEW.md
  prompt WITHOUT running the project test suite, even when the configured test
  command would fail. The fixture reaches human-review the same way as
  branches.feature (clean tree + a prior review commit behind HEAD so base..HEAD
  has a non-empty diff).

  Scenario: Human-review reaches REVIEW.md generation without running the suite
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      agenticReview: false
      """
    And a default branch "feature"
    And a prior review commit for "prev1234"
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 1" } }
      """
    And a commit "feat: add parser" that adds "src/parser.ts" with:
      """
      export const parse = (s: string) => JSON.parse(s)
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Generate REVIEW.md after successful verification"
    And stdout contains "format REVIEW.md"
    And stdout does not contain "## Test gate failed"

  Scenario: Human-review does NOT spawn the test runner
    # The configured test command writes a sentinel file when it runs. After a
    # human-review run the sentinel must be absent — proving the runner was never
    # spawned (the gate only guards `execute`, not `human-review`).
    Given a test project
    And a default branch "feature"
    And a prior review commit for "prev1234"
    And a gtd config file at "." with:
      """
      testCommand: touch RUNNER_RAN
      agenticReview: false
      """
    And a commit "feat: add parser" that adds "src/parser.ts" with:
      """
      export const parse = (s: string) => JSON.parse(s)
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Generate REVIEW.md after successful verification"
    And the file "RUNNER_RAN" does not exist
