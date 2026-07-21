@inmem
Feature: Decision log — architecture decisions recorded in squash commits

  A squash commit's message MAY carry a `## Decisions` section (one block per
  product/architecture question resolved that cycle), marked unambiguously by
  a trailing `Gtd-Decisions: true` line — squash commits take on arbitrary
  conventional-commit subjects, so the trailer, not the subject, is what makes
  a commit findable. Grilling/architecting prompts inline every such section
  found in history, oldest to newest, concatenated with no deduplication: a
  later cycle's answer to the same question doesn't erase an earlier one from
  the text, it just reads afterward as the more recent (and therefore
  authoritative) entry. Because completed cycles' squash commits are
  immutable, this concatenated text is a stable, append-only prefix across
  invocations — no local cache is needed, and the shape is exactly what LLM
  prompt caching wants. The `decisionLog` config kill-switch turns the whole
  feature off.

  Scenario: A grilling prompt surfaces a decision recorded in a squash commit
    Given a test project
    And a commit with message:
      """
      feat: add calculator

      ## Decisions

      ### Which display precision should the calculator default to?
      Answer: 2 decimal places (matches the invoicing module's rounding
      convention; human override, not the agent's suggested default).

      Gtd-Decisions: true
      """
    And a file "notes.md" with:
      """
      Build a calculator that can add and subtract.
      """
    And I run gtd step human
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "Prior decisions"
    And stdout contains "Which display precision should the calculator default to?"
    And stdout contains "2 decimal places"

  Scenario: Decisions from multiple squash commits accumulate in chronological order
    Given a test project
    And a commit with message:
      """
      feat: add calculator

      ## Decisions

      ### Which display precision should the calculator default to?
      Answer: 2 decimal places

      Gtd-Decisions: true
      """
    And a commit with message:
      """
      feat: add scientific mode

      ## Decisions

      ### Which display precision should the calculator default to?
      Answer: 6 decimal places (scientific mode needs more precision than
      the basic calculator)

      Gtd-Decisions: true
      """
    And a file "notes.md" with:
      """
      Add a memory-recall feature.
      """
    And I run gtd step human
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "2 decimal places"
    And stdout contains "6 decimal places"

  Scenario: A commit mentioning "## Decisions" in prose without the trailer is inert
    Given a test project
    And a commit with message:
      """
      docs: describe the ## Decisions section format

      This commit just documents the convention, it doesn't record any.
      """
    And a file "notes.md" with:
      """
      Build a calculator.
      """
    And I run gtd step human
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "Prior decisions"

  Scenario: decisionLog: false suppresses the prior-decisions context
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      decisionLog: false
      """
    And a commit with message:
      """
      feat: add calculator

      ## Decisions

      ### Which display precision should the calculator default to?
      Answer: 2 decimal places

      Gtd-Decisions: true
      """
    And a file "notes.md" with:
      """
      Build a calculator that can add and subtract.
      """
    And I run gtd step human
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "Prior decisions"
    And stdout does not contain "2 decimal places"
