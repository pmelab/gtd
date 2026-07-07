@live
Feature: Prompt templates — bundled Eta path

  Exercises the real bundled CLI (dist/gtd.bundle.mjs) to prove the Eta
  template system works correctly after bundling. A repo in `building` state
  must emit a prompt containing the shared header, the inlined package, the
  resolved execution model, and the auto-advance tail.

  Scenario: Building prompt contains header, package, model, and auto-advance tail
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-widget/01-widget.md" with:
      """
      Implement the widget factory.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "You are an autonomous coding agent"
    And stdout contains "### Package: `01-widget/`"
    And stdout contains "Implement the widget factory."
    And stdout contains "claude-sonnet-4-8"
    And stdout contains "run `gtd`"
