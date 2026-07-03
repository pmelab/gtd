@inmem
Feature: New Feature — capture raw input, revert to baseline, seed TODO.md

  A boundary HEAD (non-gtd, or `gtd: done`) with pending changes — or a
  `gtd: new task` HEAD whose uncommitted seed was lost — enters New Feature. The
  edge captures the input as `gtd: new task`, reverts it back to a clean
  baseline, and seeds an uncommitted TODO.md. New Feature is edge-only (no
  prompt), so a single run auto-advances into Grilling, which commits the revert
  + seed as the first `gtd: grilling`.

  Scenario: A dirty boundary tree is captured, reverted, and seeded into a plan
    Given a test project
    And a commit "feat: calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/feature.ts" with:
      """
      export const multiply = (a: number, b: number) => a * b
      """
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: new task"
    And the last commit subject is "gtd: grilling"
    # The raw input was captured then reverted, so only the seeded plan remains.
    And the file "src/feature.ts" does not exist
    And the file "TODO.md" exists
    And the file "TODO.md" contains "src/feature.ts"
    And stdout contains "## Task: Grill the plan in `TODO.md`"

  Scenario: A lost seed regenerates from the gtd: new task commit after a checkout
    # HEAD is `gtd: new task` with a clean tree — a checkout/pull dropped the
    # uncommitted TODO.md + reverted code. New Feature regenerates the seed from
    # the committed new-task diff rather than re-capturing.
    Given a test project
    And a commit "gtd: new task" that adds "src/seed.ts" with:
      """
      export const seeded = 42
      """
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: new task"
    And the last commit subject is "gtd: grilling"
    And the file "TODO.md" exists
    And the file "TODO.md" contains "src/seed.ts"
    And stdout contains "## Task: Grill the plan in `TODO.md`"
