Feature: gtd prints a structured prompt for the agent based on git state

  Scenario: New TODO.md triggers the planning task
    Given a test project
    And a file "TODO.md" with:
      """
      - build a math library
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Develop the plan in `TODO.md`"
    And stdout contains "- build a math library"
    And stdout does not contain "## Task: Execute the plan"

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

  Scenario: Clean tree after a TODO.md-only commit triggers the build task
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      - build the multiply function
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Execute the plan in `TODO.md`"

  Scenario: Clean tree after a non-TODO commit triggers the verify task
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
    And stdout contains "## Task: Commit the uncommitted changes"
    And stdout does not contain "## Task: Move `TODO:` markers"

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
    And stdout contains "## Task: Move `TODO:` markers into `TODO.md`"
    And stdout contains "## Task: Commit the uncommitted changes"
