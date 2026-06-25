# Aspirational — covers example.md "State encoding" table.
# State lives in the commit subject; the last plan commit subject selects the
# sub-state. At most one phase is active at a time.
# These scenarios are allowed to fail until the spec is implemented.

Feature: Phase is inferred from commit subjects and working-tree shape

  Scenario: Committed TODO.md with no plan commit subject is verbatim, not yet grilled
    Given a test project
    And a commit "docs: capture plan" that adds "TODO.md" with:
      """
      - build a math library
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Develop the plan in `TODO.md`"
    And stdout does not contain "## Task: Decompose"

  Scenario: plan(gtd):grilling commit with non-empty Open Questions is an awaiting-answers gate
    Given a test project
    And a commit "plan(gtd): grilling" that adds "TODO.md" with:
      """
      ## Open Questions

      ### Which operations?

      **Recommendation:** add, subtract.

      <!-- user answers here -->

      ## Plan

      - build a math library
      """
    When I run gtd
    Then it succeeds
    And stdout contains "STOP"
    And stdout does not contain "Re-run gtd immediately"
    And stdout does not contain "## Task: Decompose"

  Scenario: plan(gtd):ready complete routes to decompose
    Given a test project
    And a commit "plan(gtd): ready complete" that adds "TODO.md" with:
      """
      ## Plan

      - build a math library
      - build a calculator on top of it
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"

  Scenario: Present work packages route to execute
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-math/01-add.md" with:
      """
      Implement add
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Execute one work package"

  Scenario: Present ERRORS.md is an escalation gate
    Given a test project
    And a commit "fix(gtd): escalate failing tests" that adds "ERRORS.md" with:
      """
      # Escalation

      The test suite still fails after 3 attempts.

      ## Attempt log

      - attempt 1: tried X
      - attempt 2: tried Y
      - attempt 3: tried Z
      """
    When I run gtd
    Then it succeeds
    And stdout contains "Escalate to the human"
    And stdout contains "STOP"
    And stdout does not contain "Re-run gtd immediately"

  Scenario: Present REVIEW.md with unchecked boxes is a review gate
    Given a test project
    And a commit "review(gtd): create review for abc1234" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      ## Add foo helper

      - [ ] ./src/foo.ts#1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "STOP"
    And stdout does not contain "Re-run gtd immediately"

  Scenario: No control file routes to idle, ready for a new TODO.md
    Given a test project
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"
    And stdout does not contain "## Task: Decompose"
