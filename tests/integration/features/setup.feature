Feature: gtd setup emits a skill-install prompt

  Scenario: gtd setup emits skill install instructions
    Given a test project
    When I run gtd "setup"
    Then it succeeds
    And stdout contains "skills.sh"
    And stdout contains "skills install"
    And stdout contains "https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs"
    And stdout does not contain "## Context"
    And stdout does not contain "```diff"

  Scenario: gtd rejects unknown subcommands
    Given a test project
    When I run gtd "bogus"
    Then it fails
    And stderr contains "unknown subcommand 'bogus'"
    And stderr contains "usage: gtd [setup]"
