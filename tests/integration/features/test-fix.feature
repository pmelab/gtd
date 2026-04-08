Feature: Test-fix step — verify tests after human fix or unknown state

  Scenario: Passes through to build when tests pass after a human fix (👷)
    Given a test project
    And a commit "🤖 plan: add multiply function" that adds "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts`
      """
    And a commit "👷 fix: tweak math.ts" that updates "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b
      // human fix
      """
    When I run gtd
    Then it succeeds
    And last commit prefix is "🔨"

  Scenario: Exits with code 1 when tests keep failing after a human fix (👷)
    Given a test project
    And a staged file ".gtdrc.json" with:
      """
      {
        "testCmd": "false",
        "testRetries": 0
      }
      """
    And a commit "👷 fix: tweak math.ts" that updates "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b
      // human fix
      """
    When I run gtd
    Then it exits with code 1
    And output contains "Tests still failing"
    And git log does not contain "🔨"

  Scenario: Reports idle when no recognized prefix and tests pass
    Given a test project
    When I run gtd
    Then it succeeds
    And output contains "Nothing to do"
