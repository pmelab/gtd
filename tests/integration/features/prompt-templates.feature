@live
Feature: Prompt templates — bundled Eta path, tail contract, and fixed sections

  Exercises the real bundled CLI (dist/gtd.bundle.mjs) via `gtd next` to prove
  the Eta template system, the agent-turn tail sentence, and the fixed
  fixing/squashing sections all work correctly after bundling. The tail
  sentence appears only in plain agent prompts — never in human prompts, never
  under `--json`. No prompt ever leaks v1 marker/sentinel text or instructs
  running bare `gtd`.

  Scenario: The plain agent building prompt ends with the step-agent tail sentence
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-widget/01-widget.md" with:
      """
      Implement the widget factory.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "You are an autonomous coding agent"
    And stdout contains "### Package: `01-widget/`"
    And stdout contains "Implement the widget factory."
    And stdout contains "claude-sonnet-4-8"
    And stdout contains "Finish your turn by running `gtd step-agent`."

  Scenario: The plain human review-gate prompt has no agent tail
    Given a test project
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: awaiting review"
    When I run gtd next
    Then it succeeds
    And stdout contains ".gtd/REVIEW.md"
    And stdout does not contain "Finish your turn by running `gtd step-agent`."
    And stdout does not contain "gtd step-agent"

  Scenario: The --json building prompt omits the agent tail regardless of actor
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-widget/01-widget.md" with:
      """
      Implement the widget factory.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "Implement the widget factory."
    And stdout does not contain "Finish your turn by running `gtd step-agent`."

  Scenario: No prompt ever contains v1 marker or sentinel text
    Given a test project
    And a commit "gtd: grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      <!-- user answers here -->
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "user answers here"
    And stdout does not contain "no open questions"

  Scenario: No prompt instructs running bare gtd
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-widget/01-widget.md" with:
      """
      Implement the widget factory.
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "run `gtd`"
    And stdout does not contain "re-run gtd"

  Scenario: The fixing prompt mentions disputing findings by emptying or deleting FEEDBACK.md
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: errors" that adds ".gtd/FEEDBACK.md" with:
      """
      AssertionError: expected helper('a') to equal 'a'
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Spawn a **fix subagent**"
    And stdout contains "Or dispute the feedback"
    And stdout contains "empty or delete"
    And stdout contains "FEEDBACK.md` instead of fixing it"

  Scenario: The squashing prompt mentions overwriting SQUASH_MSG.md, no sentinel text
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      squash: true
      """
    And a commit "gtd: done"
    And a commit "gtd: squash template" that adds ".gtd/SQUASH_MSG.md" with:
      """
      <!-- gtd: replace this file's content with the real squash commit message. -->
      type: short summary
      """
    When I run gtd next
    Then it succeeds
    And stdout contains ".gtd/SQUASH_MSG.md"
    And stdout contains "conventional-commits"
    And stdout does not contain "SENTINEL"
    And stdout does not contain "marker"
