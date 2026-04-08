Feature: Cleanup commit message

  Scenario: Cleanup generates structured commit message from seed and grill
    Given a test project
    And a commit "🌱 seed: initial" that adds "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts` that multiplies two numbers
      - add a test for the `multiply` function in `tests/math.test.ts`
      """
    And a commit "🔍 grill: questions" that updates "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts` that multiplies two numbers
      - add a test for the `multiply` function in `tests/math.test.ts`

      ## Open Questions

      - What should `multiply` return when given non-numeric inputs?
      """
    And a commit "🤓 answers" that updates "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts` that multiplies two numbers
      - add a test for the `multiply` function in `tests/math.test.ts`

      ## Open Questions

      - What should `multiply` return when given non-numeric inputs?

        Throw a TypeError.
      """
    And a commit "🤖 plan: structured action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [x] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [x] add a test for the `multiply` function in `tests/math.test.ts`
      """
    And a commit "🔨 build: implement multiply" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [x] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [x] add a test for the `multiply` function in `tests/math.test.ts`
      """
    When I run gtd
    Then it succeeds
    And the last commit message subject matches "^(feat|fix|refactor):"
    And the last commit message subject does not contain "🧹"
    And the last commit message body contains "## Seed"
    And the last commit message body contains "multiply"
    And the last commit message body contains "## Grill"
    And the last commit message body contains "non-numeric inputs"

  Scenario: Cleanup generates structured message without grill when no grill phase
    Given a test project
    And a commit "🌱 seed: initial" that adds "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts` that multiplies two numbers
      """
    And a commit "🤖 plan: structured action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [x] add a `multiply` function to `src/math.ts` that multiplies two numbers
      """
    And a commit "🔨 build: implement multiply" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [x] add a `multiply` function to `src/math.ts` that multiplies two numbers
      """
    When I run gtd
    Then it succeeds
    And the last commit message subject matches "^(feat|fix|refactor):"
    And the last commit message subject does not contain "🧹"
    And the last commit message body contains "## Seed"
    And the last commit message body contains "multiply"
    And the last commit message body does not contain "## Grill"

  Scenario: Cleanup falls back to default message when no seed in history
    Given a test project
    And a commit "🤖 plan: structured action items" that adds "TODO.md" with:
      """
      # Math library

      ## Action Items

      - [x] add a `multiply` function
      """
    And a commit "🔨 build: implement multiply" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      - [x] add a `multiply` function
      """
    When I run gtd
    Then it succeeds
    And the last commit message subject is "refactor: remove TODO.md"
