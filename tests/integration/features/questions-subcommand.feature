@inmem
Feature: gtd questions subcommand

  `gtd questions` is a pure, read-only reporter over whichever of
  `.gtd/TODO.md` / `.gtd/ARCHITECTURE.md` is present. It parses the
  `## Open Questions` structure (see `document-structure.feature`) and reports
  the question list, plus any structural errors — the same diagnosis that
  would make `gtd step-agent` refuse the agent's next turn capture. It never
  mutates and always exits 0, on a clean or a dirty tree, with or without a
  well-formed file.

  Scenario: No grilling/architecting file reports an empty list
    Given a test project
    When I run gtd with args "questions"
    Then it succeeds
    And stdout contains "no open questions"

  Scenario: --json reports null/empty when no file exists
    Given a test project
    When I run gtd with args "questions --json"
    Then it succeeds
    And stdout contains "\"file\":null"
    And stdout contains "\"questions\":[]"
    And stdout contains "\"errors\":[]"

  Scenario: A well-formed TODO.md reports its open questions
    Given a test project
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Open Questions

      ### Which operations?

      Suggested default: add and subtract.
      """
    When I run gtd with args "questions"
    Then it succeeds
    And stdout contains ".gtd/TODO.md"
    And stdout contains "Which operations?"
    And stdout contains "suggested: add and subtract."

  Scenario: --json reports the structured question list for TODO.md
    Given a test project
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      ## Open Questions

      ### Which operations?

      Answer: add, subtract, and multiply.
      """
    When I run gtd with args "questions --json"
    Then it succeeds
    And stdout contains "\"file\":\".gtd/TODO.md\""
    And stdout contains "\"question\":\"Which operations?\""
    And stdout contains "\"status\":\"answered\""
    And stdout contains "\"text\":\"add, subtract, and multiply.\""
    And stdout contains "\"errors\":[]"

  Scenario: A well-formed ARCHITECTURE.md reports its open questions
    Given a test project
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      ## Open Questions

      ### Which design pattern?

      Suggested default: strategy pattern.
      """
    When I run gtd with args "questions --json"
    Then it succeeds
    And stdout contains "\"file\":\".gtd/ARCHITECTURE.md\""
    And stdout contains "\"question\":\"Which design pattern?\""

  Scenario: A malformed open question is reported as an error, not a failure
    Given a test project
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      ## Open Questions

      ### Which operations?

      Not sure yet.
      """
    When I run gtd with args "questions"
    Then it succeeds
    And stdout contains "error:"
    And stdout contains "Which operations?"
    When I run gtd with args "questions --json"
    Then it succeeds
    And stdout contains "\"questions\":[]"
    And stdout contains "\"errors\":[\"Open question"

  Scenario: gtd questions rejects extra positional arguments
    Given a test project
    When I run gtd with args "questions extra"
    Then it fails
    And stderr contains "gtd questions: too many arguments"
