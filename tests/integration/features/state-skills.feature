@inmem
Feature: the bundled workflow prepends a skills preamble to its agent prompts

  Each bundled agent step names the skills it loads through `.gtdrc`
  `skills:`, keyed by the scope full name — see `scope-skills.feature`
  for that key's own shape and validation. The bundled workflow introduces a
  step's configured skills ahead of its prompt with a preamble naming them;
  an empty list switches the preamble off for that step alone. A `.gtdrc`
  edit lands before the process under test starts — it's config, read once
  at load, not itself a turn in the history.

  Scenario: an agent step's configured skills render its prompt with the preamble prepended
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        build: [code-review, testing]
      """
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    When I run gtd next
    Then it succeeds
    And stdout contains "missing one: code-review, testing"
    And stdout contains ".gtd/FEEDBACK.md"

  Scenario: an empty configured list leaves that step's prompt bare
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        build: []
      """
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Load whatever's listed here"

  Scenario: gtd next --json carries the configured skills as an array on the skills wire key
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        build: [code-review, testing]
      """
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"code-review\""
    And stdout contains "\"testing\""
    When I run gtd next with "--json=skills.0"
    Then it succeeds
    And stdout matches "^code-review\n$"

  Scenario: an empty configured list emits no skills key at all — absent, never []
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        build: []
      """
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout is empty

  Scenario: a GTD_FIXSKILLS environment variable does nothing at all — the var it used to override is gone
    Given a test project
    And the workflow
    And an environment variable "GTD_FIXSKILLS" set to "code-review, testing"
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    When I run gtd next
    Then it succeeds
    # build.fix's bundled default (see src/workflows/skills.ts), untouched by the env var.
    And stdout contains "debugging-and-error-recovery"
    And stdout does not contain "code-review, testing"
