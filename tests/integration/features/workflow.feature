Feature: GTD workflow cycle

  Scenario: Seed and plan
    Given a test project
    And a staged TODO with multiply tasks
    When I run gtd
    Then it succeeds
    And git log contains "🌱"
    And last commit prefix is "🤖"
    And "TODO.md" contains "- [ ]"

  Scenario: Feedback and re-plan
    Given a seeded and planned project
    And "TODO.md" has appended blockquote "> please also add error handling for non-numeric inputs"
    And "src/math.ts" has an appended newline
    When I run gtd
    Then it succeeds
    And "TODO.md" does not contain "> please also add"
    And git log contains "💬"
    And git log contains "👷"
    And last commit prefix is "🤖"

  Scenario: Build action items
    Given a planned project with feedback
    When I run gtd
    Then it succeeds
    And "src/math.ts" contains "multiply"
    And npm test passes
    And "TODO.md" contains "- [x]"
    And last commit prefix is "🔨"

  Scenario: Code TODOs committed
    Given a built project
    And "src/math.ts" has prepended "// TODO: never use magic numbers, always use named constants"
    And "TODO.md" has appended blockquote "> please add a subtract function too"
    And "src/math.ts" has appended "// fixed"
    When I run gtd
    Then it succeeds
    And "src/math.ts" does not contain "// TODO: never use magic numbers"
    And git log contains "🤦"
    And git log contains "💬"
    And last commit prefix is "🤖"

  Scenario: Second build after feedback
    Given a project with code TODOs processed
    When I run gtd
    Then it succeeds
    And npm test passes
    And last commit prefix is "🔨"

  Scenario: Learn and cleanup
    Given a twice-built project
    And "TODO.md" has a learnings section
    And the "magic numbers" learning is removed from "TODO.md"
    When I run gtd
    Then it succeeds
    And "AGENTS.md" exists
    And git log contains "🎓"
    And git log contains "🧹"
    And "TODO.md" does not exist

  Scenario: Idle when done
    Given a fully completed project
    When I run gtd
    Then it succeeds
    And output contains "Nothing to do"
