@inmem
Feature: New Feature entry — dirty boundary tree becomes the first grilling turn

  A boundary HEAD (non-gtd, or `gtd: done`) with a pending change is the entry
  point into grilling: `gtd step` captures everything pending — sketches,
  prose, code — into exactly one turn commit, `gtd(human): grilling`. There is
  no machine-authored seed and no revert; the captured files stay in the
  tree's history and the working tree is clean afterwards. Out of scope: a
  clean boundary tree is not an entry point at all, so `gtd step` is a no-op.

  Scenario: A dirty boundary tree becomes the first human grilling turn
    Given a test project
    And a commit "feat: calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/feature.ts" with:
      """
      export const multiply = (a: number, b: number) => a * b
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    And the file "src/feature.ts" exists
    And the file "src/feature.ts" contains "export const multiply"
    And stdout contains "committed: gtd(human): grilling"

  Scenario: A dirty boundary tree after gtd: done also becomes a grilling turn
    Given a test project
    And a commit "gtd: done"
    And a file "src/extra.ts" with:
      """
      export const extra = () => "extra"
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    And the file "src/extra.ts" exists
    And the file "src/extra.ts" contains "export const extra"

  Scenario: A clean boundary tree is out of scope — gtd step is a no-op
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "feat: calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And I record the commit count
    When I run gtd step
    Then it succeeds
    And the commit count is unchanged
