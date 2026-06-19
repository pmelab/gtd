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
    And stdout does not contain "## Task: Decompose"

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

  Scenario: Clean tree after a TODO.md-only commit triggers decompose
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      - build the multiply function
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose `TODO.md` into work packages"
    And stdout contains "planning model"

  Scenario: TODO.md with simple marker triggers execute-simple
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Add a greeting to the CLI output

      <!-- simple -->
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Execute simple task"
    And stdout does not contain "## Task: Decompose"

  Scenario: TODO.md without simple marker triggers decompose
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Refactor authentication to use JWT
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout does not contain "## Task: Execute simple task"

  Scenario: Existing .gtd with packages triggers execute
    Given a test project
    And a commit "plan(gtd): decompose" that adds ".gtd/01-math/01-add.md" with:
      """
      Implement the add function
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-math/COMMIT_MSG.md" with:
      """
      feat(math): implement addition
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Execute all work packages"
    And stdout contains "01-math"
    And stdout contains "01-add.md"

  Scenario: Execute prompt lists all packages when multiple exist
    Given a test project
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      First task
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/COMMIT_MSG.md" with:
      """
      feat: first
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/02-bar/01-task.md" with:
      """
      Second task
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/02-bar/COMMIT_MSG.md" with:
      """
      feat: second
      """
    When I run gtd
    Then it succeeds
    And stdout contains "01-foo"
    And stdout contains "02-bar"

  Scenario: Empty .gtd directory triggers cleanup
    Given a test project
    And a directory ".gtd"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Clean up after build completion"

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
