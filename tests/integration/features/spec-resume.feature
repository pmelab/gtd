# Aspirational — covers example.md Rule 7 (resume / hard reset) and Principle 1.
# The process is resumable from any commit. The test loop is the one
# non-checkpointed span: interrupted mid-loop, it resumes from the
# package-execution commit and restarts the loop cold via a hard reset of the
# working tree. Allowed to fail.

Feature: Resume is from committed state with a hard reset of the working tree

  Scenario: A package-execution commit with a dirty tree resumes by hard-resetting to it
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      agenticReview: false
      """
    And a default branch "feature"
    And a prior review commit for "prev1234"
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "echo SENTINEL_FAILURE; exit 1" } }
      """
    And a commit "feat(gtd): execute package 01-foo" that adds "src/foo.ts" with:
      """
      export const foo = () => 1
      """
    And "src/foo.ts" is modified to:
      """
      export const foo = () => 1
      // half-finished fix attempt, never committed
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "chore(gtd): commit pending changes"
    And stdout contains "## Task: Generate REVIEW.md after successful verification"

  Scenario: The fix prompt documents the hard-reset resume contract
    # The fix-tests prompt is only reachable via the execute test gate now
    # (human-review is no longer gated). A red package.json with a pending package
    # drives the gate red and emits the fix prompt.
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "echo SENTINEL_FAILURE; exit 1" } }
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      First task
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Test gate failed"
    And stdout contains "git reset"

  Scenario: Any clean commit is a valid resume point — re-running is deterministic
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      First task
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Execute one work package"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Execute one work package"
