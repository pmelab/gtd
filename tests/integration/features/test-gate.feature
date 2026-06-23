Feature: Human-review test gate

  The human-review leaf runs the project test suite first. A green run proceeds
  to REVIEW.md generation; a red run below the cap emits the fix-tests prompt
  with the captured failure output; a red run at the consecutive-fix(gtd) cap
  (counted only for commits carrying the `Gtd-Test-Fix:` trailer) escalates to
  the human. The fixture reaches human-review the same way as branches.feature
  (clean tree + a prior review commit behind HEAD so base..HEAD has a non-empty
  diff) and carries a COMMITTED package.json whose `test` script drives the gate
  green or red on demand.

  Scenario: Green test gate proceeds to REVIEW.md generation
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
    And stdout contains "## Task: Generate REVIEW.md after successful verification"
    And stdout contains "format REVIEW.md"
    And stdout does not contain "## Test gate failed"

  Scenario: Red test gate below the cap emits the fix-tests prompt with captured output
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
    And stdout contains "fix(gtd): <desc>"
    And stdout contains "SENTINEL_FAILURE"
    And stdout does not contain "format REVIEW.md"

  Scenario: A red package.json at the consecutive-fix(gtd) trailer cap escalates to the human
    # At the cap the machine resolves to `escalate` before `human-review`, so the
    # edge never runs the gate — escalation wins over the red test command. The
    # 5 fix(gtd) commits (each carrying a Gtd-Test-Fix: trailer) must be in the
    # counted range, so default branch differs from the feature branch they live on
    # (mirrors verify-loop.feature).
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
    And a fix(gtd) commit "fix(gtd): attempt 4"
    And a fix(gtd) commit "fix(gtd): attempt 5"
    When I run gtd
    Then it succeeds
    And stdout contains "Escalate to the human"
    And stdout does not contain "## Test gate failed"
