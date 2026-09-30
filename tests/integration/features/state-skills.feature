@inmem
Feature: the bundled workflow prepends a skills preamble to its agent prompts

  Each bundled agent step names the skills it loads through a `*Skills` var,
  and the bundled workflow introduces them ahead of the prompt with a preamble
  naming them. Blanking one step's `*Skills` var switches it off for that step
  alone.

  Background:
    Given a test project
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"

  Scenario: an agent step naming skills renders its prompt with the preamble prepended
    Given an environment variable "GTD_FIXSKILLS" set to "code-review, testing"
    When I run gtd next
    Then it succeeds
    And stdout contains "missing one: code-review, testing"
    And stdout contains ".gtd/FEEDBACK.md"

  Scenario: blanking a step's own skills var leaves that step's prompt bare
    Given an environment variable "GTD_FIXSKILLS" set to ""
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Load whatever's listed here"

  Scenario: gtd next --json carries the declared skills as a trimmed array on the skills wire key
    Given an environment variable "GTD_FIXSKILLS" set to "code-review, testing"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"code-review\""
    And stdout contains "\"testing\""
    When I run gtd next with "--json=skills.0"
    Then it succeeds
    And stdout matches "^code-review\n$"

  Scenario: blanking a step's own skills var emits no skills key at all — absent, never []
    Given an environment variable "GTD_FIXSKILLS" set to ""
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout is empty
