@inmem
Feature: the bundled workflow prepends a skills preamble to its agent prompts

  Each bundled agent step names the skills it loads through a `*Skills` var,
  and the `skillsPreamble` var introduces them ahead of the prompt, with
  `{skills}` standing for the step's skill names. Blanking `skillsPreamble`
  switches the preamble off for every step; blanking one step's `*Skills` var
  switches it off for that step alone.

  Background:
    Given a test project
    And the workflow
    And an environment variable "GTD_SKILLSPREAMBLE" set to "Load only what your harness has, skip the rest silently: {skills}."
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
    And stdout contains "Load only what your harness has, skip the rest silently: code-review, testing."
    And stdout contains ".gtd/FEEDBACK.md"

  Scenario: blanking skillsPreamble renders the same step's prompt unchanged
    Given an environment variable "GTD_SKILLSPREAMBLE" set to ""
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Load only what your harness has"
    And stdout contains ".gtd/FEEDBACK.md"

  Scenario: blanking a step's own skills var leaves that step's prompt bare
    Given an environment variable "GTD_FIXSKILLS" set to ""
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Load only what your harness has"
