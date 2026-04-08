Feature: Baseline test check before build

  Scenario: Exits with code 1 when baseline tests fail before building
    Given a test project
    And a staged file ".gtdrc.json" with:
      """
      {
        "testCmd": "false"
      }
      """
    And a staged file "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts`
      """
    And a commit "🤖 plan: add multiply function"
    When I run gtd
    Then it exits with code 1
    And output contains "Baseline tests failed"
    And git log does not contain "🔨"
