Feature: Code TODO comments in feedback workflow

  Scenario: code-only TODO comments survive the 🤦 commit and are processed by the plan step
    Given a test project
    And a commit "🤖 plan: initial plan" that adds "TODO.md" with:
      """
      # Math Library

      ## Action Items

      - [ ] add a subtract function to src/math.ts
      """
    And a staged file "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b
      // TODO: add unit tests for the add function
      """
    When I run gtd
    Then it succeeds
    And git log contains "💬"
    And the "💬" commit diff contains "// TODO:"
    And last commit prefix is "🤖"
    And "src/math.ts" does not contain "// TODO:"
    And "TODO.md" contains "unit tests"
