Feature: Grill design interview step

  Scenario: Seed triggers grill step
    Given a test project
    And a staged file "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts` that multiplies two numbers
      - add a test for the `multiply` function in `tests/math.test.ts`
      """
    When I run gtd
    Then it succeeds
    And git log contains "🌱"
    And last commit prefix is "🔍"
    And "TODO.md" contains "## Open Questions"

  Scenario: Grill loop continues while open questions remain
    Given a test project
    And a commit "🌱 seed: initial idea" that adds "TODO.md" with:
      """
      - add a multiply function
      """
    And a commit "🔍 grill: questions" that updates "TODO.md" with:
      """
      # Multiply feature

      ## Open Questions

      - What should happen when non-numeric inputs are passed?
      """
    When I run gtd
    Then it succeeds
    And last commit prefix is "🔍"

  Scenario: Grill graduates to plan when open questions are removed
    Given a test project
    And a commit "🌱 seed: initial idea" that adds "TODO.md" with:
      """
      - add a multiply function
      """
    And a commit "🔍 grill: questions" that updates "TODO.md" with:
      """
      # Multiply feature

      Throw a TypeError for non-numeric inputs.
      """
    When I run gtd
    Then it succeeds
    And last commit prefix is "🤖"
    And "TODO.md" contains "- [ ]"

  Scenario: User answers are committed as 🤓 before grill resumes
    Given a test project
    And a commit "🌱 seed: initial idea" that adds "TODO.md" with:
      """
      - add a multiply function
      """
    And a commit "🔍 grill: questions" that updates "TODO.md" with:
      """
      # Multiply feature

      ## Open Questions

      - What should happen when non-numeric inputs are passed?
      """
    And "TODO.md" has appended "  Throw a TypeError for non-numeric inputs."
    When I run gtd
    Then it succeeds
    And git log contains "🤓"
    And last commit prefix is "🔍"
