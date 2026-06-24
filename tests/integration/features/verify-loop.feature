Feature: Verify loop and escalation cap

  The verify loop counts consecutive `fix(gtd):` commits that carry a
  `Gtd-Test-Fix:` trailer. Only trailer-carrying commits advance the counter;
  a plain `fix(gtd):` feature commit (no trailer) does NOT advance the counter
  and is treated like any other non-fix commit. At the cap the machine escalates
  and STOPs; any non-advancing commit resets the counter so planning can resume.

  Scenario: Mixed code and TODO.md dirty commits only code, leaving TODO.md dirty
    # The code-changes edge commits the dirty source but restores TODO.md, leaving
    # it uncommitted. One gtd run commits the code and drives the loop forward; the
    # still-dirty new TODO.md then routes to the planning prompt.
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
    And the last commit subject is "chore(gtd): commit pending changes"
    And the file "TODO.md" exists
    And stdout contains "## Task: Develop the plan in `TODO.md`"
    And stdout does not contain "## Task: Commit the uncommitted changes"

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

  Scenario: A plain fix(gtd) feature commit (no trailer) resets the counter and planning resumes
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a fix(gtd) commit "fix(gtd): attempt 1"
    And a fix(gtd) commit "fix(gtd): attempt 2"
    And a fix(gtd) commit "fix(gtd): attempt 3"
    And a fix(gtd) commit "fix(gtd): attempt 4"
    And a fix(gtd) commit "fix(gtd): attempt 5"
    And a plain fix(gtd) feature commit "fix(gtd): plain feature fix, no trailer"
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
