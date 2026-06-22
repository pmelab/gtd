Feature: gtd prints a structured prompt for the agent based on git state

  Scenario: New TODO.md with open questions triggers the planning task
    Given a test project
    And a file "TODO.md" with:
      """
      ## Open Questions

      ### What operations?

      **Recommendation:** add, subtract.

      <!-- user answers here -->

      ## Plan

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

      ### What precision?

      **Recommendation:** double.

      <!-- user answers here -->

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

  Scenario: Decompose prompt instructs recording TODO.md before deleting it
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      - build the multiply function
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "docs(plan): record TODO.md"

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

  Scenario: Clean tree with no reviewable base routes to verified
    Given a test project
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"
    And stdout does not contain "## Task: Generate REVIEW.md"

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

  Scenario: New TODO: markers in code are ordinary code and yield only the commit task
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
    And stdout contains "## Task: Commit the uncommitted changes"
    And stdout does not contain "## Task: Move `TODO:` markers into `TODO.md`"

  Scenario: Parent-branch merge-base behind HEAD triggers human-review
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      """
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Generate REVIEW.md after successful verification"
    And stdout contains "### Diff (`git diff"

  Scenario: Prior review commit behind HEAD triggers human-review
    Given a test project
    And a default branch "feature"
    And a prior review commit for "prev1234"
    And a commit "feat: add parser" that adds "src/parser.ts" with:
      """
      export const parse = (s: string) => JSON.parse(s)
      """
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Generate REVIEW.md after successful verification"
    And stdout contains "### Diff (`git diff"

  Scenario: Both parent-branch and prior-review present, closer one wins
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: old-module" that adds "src/old-module.ts" with:
      """
      export const oldFn = () => "old"
      """
    And a prior review commit for "midpoint"
    And a commit "feat: new-module" that adds "src/new-module.ts" with:
      """
      export const newFn = () => "new"
      """
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Generate REVIEW.md after successful verification"
    And stdout contains "src/new-module.ts"
    And stdout does not contain "src/old-module.ts"

  Scenario: Review base equals HEAD produces verified terminal
    Given a test project
    And a default branch "feature"
    And a prior review commit for "tiphash"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"
    And stdout does not contain "## Task: Generate REVIEW.md"
