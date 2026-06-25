# Aspirational — covers example.md Principles 2 ("auto-invoke until a gate")
# and 4 ("no escape hatches"). Progress states instruct an immediate re-run;
# gates and conclusion STOP and never auto-advance. There is no cancel/abort
# command. Allowed to fail.

Feature: Auto-invoke continues until a human gate; no escape hatches exist

  Scenario: A progress state instructs an immediate re-run
    Given a test project
    And a commit "plan(gtd): ready complete" that adds "TODO.md" with:
      """
      ## Plan

      - build a math library
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "Re-run gtd immediately"
    And stdout does not contain "STOP"

  Scenario: An open-questions gate STOPs and does not auto-advance
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

  Scenario: Conclusion STOPs and reports readiness for a new TODO.md
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
    And stdout contains "STOP"
    And stdout does not contain "Re-run gtd immediately"

  Scenario: There is no cancel/abort escape hatch
    Given a test project
    And a commit "plan(gtd): ready complete" that adds "TODO.md" with:
      """
      ## Plan

      - build a math library
      """
    When I run gtd with args "abort"
    Then it fails
