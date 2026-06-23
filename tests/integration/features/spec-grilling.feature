# Aspirational — covers example.md Rule 3 (grilling). Grilling ensures an
# "## Open Questions" section, moves answered Q&A to a "## Resolved" graveyard,
# and on completion sets status: simple (<=5 files) or status: complete.
# Allowed to fail.

Feature: Grilling drives the plan toward a simple/complete marker

  Scenario: A freshly committed TODO.md is grilled (Open Questions added, status grilling)
    Given a test project
    And a commit "docs: capture plan" that adds "TODO.md" with:
      """
      - build a math library
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Develop the plan in `TODO.md`"
    And stdout contains "## Open Questions"
    And stdout contains "status: grilling"

  Scenario: Answering questions re-grills, moving answered Q&A to the Resolved graveyard
    Given a test project
    And a commit "docs: grill plan" that adds "TODO.md" with:
      """
      ---
      status: grilling
      ---

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
      ---
      status: grilling
      ---

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

  Scenario: A plan confined to five files or fewer is marked simple
    Given a test project
    And a commit "docs: grill plan" that adds "TODO.md" with:
      """
      ---
      status: grilling
      ---

      ## Open Questions

      ## Plan

      - add a greeting string to src/cli.ts
      """
    And "TODO.md" is modified to:
      """
      ---
      status: grilling
      ---

      ## Open Questions

      ## Plan

      - add a greeting string to src/cli.ts (one file, no open questions)
      """
    When I run gtd
    Then it succeeds
    And stdout contains "five files or fewer"
    And stdout contains "status: simple"

  Scenario: A plan spanning more than five files is marked complete
    Given a test project
    And a commit "docs: grill plan" that adds "TODO.md" with:
      """
      ---
      status: grilling
      ---

      ## Open Questions

      ## Plan

      - rework auth across src/a.ts, src/b.ts, src/c.ts, src/d.ts, src/e.ts, src/f.ts
      """
    And "TODO.md" is modified to:
      """
      ---
      status: grilling
      ---

      ## Open Questions

      ## Plan

      - rework auth across six files, no open questions remain
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Incorporate edits to `TODO.md`"
    And stdout contains "status: complete"
