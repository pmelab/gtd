# Aspirational — covers example.md Rule 6 (test loop). The loop runs whenever
# there are committed-but-untested code changes (after a package OR after human
# code edits). It retains the error + attempt log in an UNCOMMITTED ERRORS.md,
# does NOT commit per attempt, and commits only on success (discarding ERRORS.md)
# or on escalation. Escalates after 3 attempts, or immediately on a recurring
# error signature. Allowed to fail.

Feature: Test/fix loop with bounded, memory-retaining escalation

  Scenario: A red test gate below the cap emits the fix prompt with captured output
    Given a test project
    And a default branch "feature"
    And a prior review commit for "prev1234"
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "echo SENTINEL_FAILURE; exit 1" } }
      """
    And a commit "feat: add parser" that adds "src/parser.ts" with:
      """
      export const parse = (s: string) => JSON.parse(s)
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Test gate failed"
    And stdout contains "SENTINEL_FAILURE"

  Scenario: The fix prompt retains prior attempts and writes them to an uncommitted ERRORS.md
    Given a test project
    And a default branch "feature"
    And a prior review commit for "prev1234"
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "echo SENTINEL_FAILURE; exit 1" } }
      """
    And a commit "feat: add parser" that adds "src/parser.ts" with:
      """
      export const parse = (s: string) => JSON.parse(s)
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Test gate failed"
    And stdout contains "ERRORS.md"
    And stdout contains "previous attempts"

  Scenario: The fix prompt forbids committing per attempt, committing only on success or escalation
    Given a test project
    And a default branch "feature"
    And a prior review commit for "prev1234"
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "echo SENTINEL_FAILURE; exit 1" } }
      """
    And a commit "feat: add parser" that adds "src/parser.ts" with:
      """
      export const parse = (s: string) => JSON.parse(s)
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Test gate failed"
    And stdout contains "only commit on success or escalation"

  Scenario: The test loop also runs after human code edits, not just after a package
    Given a test project
    And a default branch "feature"
    And a prior review commit for "prev1234"
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "echo SENTINEL_FAILURE; exit 1" } }
      """
    And a commit "fix: human tweak" that adds "src/human.ts" with:
      """
      export const human = () => 1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Test gate failed"
    And stdout contains "SENTINEL_FAILURE"

  Scenario: A red gate at the third consecutive fix attempt escalates and commits ERRORS.md
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "echo SENTINEL_FAILURE; exit 1" } }
      """
    And a fix(gtd) commit "fix(gtd): attempt 1"
    And a fix(gtd) commit "fix(gtd): attempt 2"
    And a fix(gtd) commit "fix(gtd): attempt 3"
    When I run gtd
    Then it succeeds
    And stdout contains "Escalate to the human"
    And stdout contains "ERRORS.md"
    And stdout contains "STOP"
    And stdout does not contain "## Test gate failed"

  Scenario: Two consecutive fix attempts stay in the loop, below the cap of three
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "echo SENTINEL_FAILURE; exit 1" } }
      """
    And a fix(gtd) commit "fix(gtd): attempt 1"
    And a fix(gtd) commit "fix(gtd): attempt 2"
    When I run gtd
    Then it succeeds
    And stdout contains "## Test gate failed"
    And stdout does not contain "Escalate to the human"

  Scenario: A recurring error signature escalates immediately, before the cap
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "echo SAME_SIGNATURE; exit 1" } }
      """
    And a commit "fix(gtd): attempt 1 recorded the same failure" that adds "ERRORS.md" with:
      """
      # Attempt log

      - attempt 1: test failed with SAME_SIGNATURE
      """
    When I run gtd
    Then it succeeds
    And stdout contains "Escalate to the human"
    And stdout contains "no progress"
    And stdout does not contain "## Test gate failed"

  Scenario: Plain fix(gtd) feature commits (no trailer) with a green test gate do not escalate
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a plain fix(gtd) feature commit "fix(gtd): plain feature fix 1"
    And a plain fix(gtd) feature commit "fix(gtd): plain feature fix 2"
    And a plain fix(gtd) feature commit "fix(gtd): plain feature fix 3"
    And a plain fix(gtd) feature commit "fix(gtd): plain feature fix 4"
    And a plain fix(gtd) feature commit "fix(gtd): plain feature fix 5"
    When I run gtd
    Then it succeeds
    And stdout does not contain "Escalate to the human"
