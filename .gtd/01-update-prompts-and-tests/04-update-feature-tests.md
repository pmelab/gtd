# Update integration test scenarios

## Description

Update `tests/integration/features/branches.feature` to reflect the new TODO.md structure where `## Open Questions` appears at the top of the file.

## File to Modify

`tests/integration/features/branches.feature`

## Changes

### Change 1: Update "Modified TODO.md triggers refinement" scenario

**Old text (around line 22-41):**
```gherkin
  Scenario: Modified TODO.md triggers the refinement task
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      - build a math library

      ## Open Questions

      ### What operations?

      **Recommendation:** add, subtract.

      <!-- user answers here -->
      """
    And "TODO.md" is modified to:
      """
      - build a math library

      ## Open Questions

      ### What operations?

      **Recommendation:** add, subtract.

      add, subtract, multiply, divide
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Incorporate edits to `TODO.md`"
```

**New text:**
```gherkin
  Scenario: Modified TODO.md triggers the refinement task
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      ## Open Questions

      ### What operations?

      **Recommendation:** add, subtract.

      <!-- user answers here -->

      ## Plan

      - build a math library

      ## Answered Questions
      """
    And "TODO.md" is modified to:
      """
      ## Open Questions

      ### What operations?

      **Recommendation:** add, subtract.

      add, subtract, multiply, divide

      ## Plan

      - build a math library

      ## Answered Questions
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Incorporate edits to `TODO.md`"
```

## Acceptance Criteria

- [ ] "Modified TODO.md triggers refinement" scenario has `## Open Questions` at TOP
- [ ] Scenario includes `## Answered Questions` section at bottom (even if empty)
- [ ] Plan content appears between the two sections
- [ ] Test still passes after changes (the detection logic uses marker presence, not section order)
