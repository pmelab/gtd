Feature: Auto-advance and STOP markers in prompts

  Scenario: New TODO triggers auto-advance instruction
    Given a test project
    And a file "TODO.md" with:
      """
      - build a math library
      """
    When I run gtd
    Then it succeeds
    And stdout contains "Re-run gtd immediately"
    And stdout contains "Do not wait for user"

  Scenario: Decompose prompt includes auto-advance
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      ## Plan

      - build a math library

      ## Answered Questions

      ### Is this enough?

      **Decision:** Yes.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "Re-run gtd immediately"

  Scenario: Code changes prompt includes auto-advance
    Given a test project
    And a file "hello.txt" with:
      """
      hello world
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Commit the uncommitted changes"
    And stdout contains "Re-run gtd immediately"

  Scenario: Verified prompt contains STOP and no auto-advance
    Given a test project
    And a commit "feat: init" that adds "index.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"
    And stdout contains "STOP"
    And stdout does not contain "Re-run gtd immediately"

  Scenario: Review-create prompt contains STOP and no auto-advance
    Given a test project
    And a commit "feat: init" that adds "index.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with ref "HEAD~1"
    Then it succeeds
    And stdout contains "## Task: Generate REVIEW.md"
    And stdout contains "STOP"
    And stdout does not contain "Re-run gtd immediately"
