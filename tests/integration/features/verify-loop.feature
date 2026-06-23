Feature: Verify loop and escalation cap

  The verify loop counts consecutive `fix(gtd):` commits. Below the cap the
  machine keeps making progress; at the cap it escalates and STOPs. A green run
  (a non-`fix(gtd):` commit) resets the counter so planning can resume.

  Scenario: Mixed code and TODO.md dirty commits only code, leaving TODO.md dirty
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
    And a file "TODO.md" with:
      """
      - refine the math library
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Commit the uncommitted changes"
    And stdout contains "Do not commit `TODO.md`"
    And stdout does not contain "## Task: Develop the plan in `TODO.md`"

  Scenario: A chain of fix(gtd) commits below the cap stays in a gated state
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a fix(gtd) commit "fix(gtd): attempt 1"
    And a fix(gtd) commit "fix(gtd): attempt 2"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"
    And stdout does not contain "Escalate to the human"

  Scenario: A chain of fix(gtd) commits at the cap escalates and stops
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a fix(gtd) commit "fix(gtd): attempt 1"
    And a fix(gtd) commit "fix(gtd): attempt 2"
    And a fix(gtd) commit "fix(gtd): attempt 3"
    And a fix(gtd) commit "fix(gtd): attempt 4"
    And a fix(gtd) commit "fix(gtd): attempt 5"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Escalate to the human"
    And stdout contains "STOP"
    And stdout does not contain "Re-run gtd immediately"

  Scenario: A non-fix commit resets the counter and planning resumes
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a fix(gtd) commit "fix(gtd): attempt 1"
    And a fix(gtd) commit "fix(gtd): attempt 2"
    And a fix(gtd) commit "fix(gtd): attempt 3"
    And a fix(gtd) commit "fix(gtd): attempt 4"
    And a fix(gtd) commit "fix(gtd): attempt 5"
    And a commit "feat: real progress" that adds "src/done.ts" with:
      """
      export const done = true
      """
    And a file "TODO.md" with:
      """
      ## Open Questions

      ### What should the next iteration cover?

      **Recommendation:** finish the math library.

      <!-- user answers here -->

      ## Plan

      - plan the next iteration
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Develop the plan in `TODO.md`"
    And stdout does not contain "Escalate to the human"
