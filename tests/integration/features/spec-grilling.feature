# Aspirational — covers example.md Rule 3 (grilling). Grilling ensures an
# "## Open Questions" section, moves answered Q&A to a "## Resolved" graveyard,
# and on completion sets plan(gtd): ready complete.
# Allowed to fail.

Feature: Grilling drives the plan toward a ready-complete commit

  Scenario: A freshly committed TODO.md is grilled (Open Questions added)
    Given a test project
    And a commit "docs: capture plan" that adds "TODO.md" with:
      """
      - build a math library
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Develop the plan in `TODO.md`"
    And stdout contains "## Open Questions"
    And stdout contains "plan(gtd): grilling"

  Scenario: Answering questions re-grills, moving answered Q&A to the Resolved graveyard
    Given a test project
    And a commit "plan(gtd): grilling" that adds "TODO.md" with:
      """
      ## Open Questions

      ### Which operations?

      **Recommendation:** add, subtract.

      <!-- user answers here -->

      ## Plan

      - build a math library

      ## Resolved
      """
    And "TODO.md" is modified to:
      """
      ## Open Questions

      ### Which operations?

      **Recommendation:** add, subtract.

      add, subtract, multiply, divide

      ## Plan

      - build a math library

      ## Resolved
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Incorporate edits to `TODO.md`"
    And stdout contains "## Resolved"
