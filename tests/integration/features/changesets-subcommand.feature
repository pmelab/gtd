@inmem
Feature: gtd changesets subcommand

  `gtd changesets` is a pure, read-only reporter over `.gtd/REVIEW.md`, if
  present. It parses the header/base-comment/chunk structure (see
  `document-structure.feature`) and reports the changeset/file list, plus any
  structural errors — the same diagnosis that would make `gtd step agent`
  refuse the agent's next review-turn capture. It never mutates and always
  exits 0, on a clean or a dirty tree, with or without a well-formed file.

  Scenario: No REVIEW.md reports an empty list
    Given a test project
    When I run gtd with args "changesets"
    Then it succeeds
    And stdout contains "no review in progress"

  Scenario: --json reports null/empty when no file exists
    Given a test project
    When I run gtd with args "changesets --json"
    Then it succeeds
    And stdout contains "\"file\":null"
    And stdout contains "\"changesets\":[]"
    And stdout contains "\"errors\":[]"

  Scenario: A well-formed REVIEW.md reports its changesets and files
    Given a test project
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: abc1234000000000000000000000000000000 -->

      ## Add calculator

      New add function for the calculator.

      - [ ] ./src/calc.ts#1
      - [x] ./src/calc.ts#5
      """
    When I run gtd with args "changesets"
    Then it succeeds
    And stdout contains ".gtd/REVIEW.md"
    And stdout contains "abc1234"
    And stdout contains "Add calculator"
    And stdout contains "[ ] ./src/calc.ts#1"
    And stdout contains "[x] ./src/calc.ts#5"

  Scenario: --json reports the structured changeset list
    Given a test project
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: abc1234000000000000000000000000000000 -->

      ## Add calculator

      - [ ] ./src/calc.ts#1 — new add function
      """
    When I run gtd with args "changesets --json"
    Then it succeeds
    And stdout contains "\"file\":\".gtd/REVIEW.md\""
    And stdout contains "\"shortHash\":\"abc1234\""
    And stdout contains "\"fullHash\":\"abc1234000000000000000000000000000000\""
    And stdout contains "\"title\":\"Add calculator\""
    And stdout contains "\"path\":\"./src/calc.ts\""
    And stdout contains "\"line\":1"
    And stdout contains "\"checked\":false"
    And stdout contains "\"note\":\"new add function\""
    And stdout contains "\"errors\":[]"

  Scenario: A malformed REVIEW.md is reported as errors, not a failure
    Given a test project
    And a file ".gtd/REVIEW.md" with:
      """
      # Review

      ## Add calculator

      Just prose, no pointers.
      """
    When I run gtd with args "changesets"
    Then it succeeds
    And stdout contains "error:"
    When I run gtd with args "changesets --json"
    Then it succeeds
    And stdout contains "\"errors\":["
    And stdout contains "Missing or malformed"
    And stdout contains "Missing '<!-- base:"
    And stdout contains "has no file pointers"

  Scenario: gtd changesets rejects extra positional arguments
    Given a test project
    When I run gtd with args "changesets extra"
    Then it fails
    And stderr contains "gtd changesets: too many arguments"
