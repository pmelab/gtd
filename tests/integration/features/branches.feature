Feature: gtd prints a structured prompt for the agent based on git state

  Scenario: New TODO.md triggers the seeding/grilling task
    Given a test project
    And a file "TODO.md" with:
      """
      - build a math library
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Seed the plan from a fresh `TODO.md`"
    And stdout contains "`grill-with-docs` skill"
    And stdout does not contain "## Appendix: grill-with-docs methodology"
    And stdout contains "- build a math library"
    And stdout does not contain "## Task: Build every unchecked item"

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
    And stdout contains "`grill-with-docs` skill"
    And stdout does not contain "## Appendix: grill-with-docs methodology"

  Scenario: Clean tree after a TODO.md-only commit triggers the build task
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      - [ ] add the multiply function
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Build every unchecked item in `TODO.md`"
    And stdout does not contain "## Appendix: grill-with-docs methodology"

  Scenario: Clean tree after a non-TODO commit triggers the run-tests task
    Given a test project
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Verify the working tree is healthy"

  Scenario: Uncommitted code changes trigger the commit task
    Given a test project
    And a commit "feat: math" that adds "src/math.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And "src/math.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Commit uncommitted code changes"
    And stdout does not contain "## Task: Extract `TODO:` markers"

  Scenario: New TODO: markers in code compose with the commit task
    Given a test project
    And a commit "feat: math" that adds "src/math.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And "src/math.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // TODO: implement subtraction
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Extract `TODO:` markers into `TODO.md`"
    And stdout contains "## Task: Commit uncommitted code changes"
