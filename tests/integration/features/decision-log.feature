@inmem
Feature: Decision log — .gtd/DECISIONS.md as durable prior-decision context

  `.gtd/DECISIONS.md` is the one steering file gtd never deletes itself: unlike
  TODO.md/ARCHITECTURE.md/REVIEW.md, it accumulates across the project's whole
  life. Grilling/architecting/squashing prompts inline its current content as
  "Prior decisions" context. If a human deletes it, gtd doesn't silently start
  over — it recovers the last known content from git history (the commit right
  before the deletion) so the context survives until squashing next
  re-materializes the file on disk. The `decisionLog` config kill-switch turns
  the whole feature off.

  Scenario: A grilling prompt surfaces decisions recorded in .gtd/DECISIONS.md
    Given a test project
    And a file ".gtd/DECISIONS.md" with:
      """
      # Architecture & Product Decisions

      ### Calculator display precision
      Decimal display defaults to 2 places (matches the invoicing module's
      rounding convention; human override, not the agent's suggested default).
      """
    And the working tree is committed as "chore: seed decisions"
    And a file "notes.md" with:
      """
      Build a calculator that can add and subtract.
      """
    And I run gtd step
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "Prior decisions"
    And stdout contains "Calculator display precision"
    And stdout contains "Decimal display defaults to 2 places"

  Scenario: decisionLog: false suppresses the prior-decisions context
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      decisionLog: false
      """
    And a file ".gtd/DECISIONS.md" with:
      """
      # Architecture & Product Decisions

      ### Calculator display precision
      Decimal display defaults to 2 places.
      """
    And the working tree is committed as "chore: seed decisions"
    And a file "notes.md" with:
      """
      Build a calculator that can add and subtract.
      """
    And I run gtd step
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "Prior decisions"
    And stdout does not contain "Calculator display precision"

  Scenario: A deleted .gtd/DECISIONS.md is restored from git history rather than silently dropped
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      squash: true
      learning: false
      """
    And a file ".gtd/DECISIONS.md" with:
      """
      # Architecture & Product Decisions

      ### Operation chaining
      Operations are not chainable — one operation per call, by design.
      """
    And the working tree is committed as "chore: seed decisions"
    And a commit "chore: pre-cycle work" that adds "src/existing.ts" with:
      """
      export const existing = 1
      """
    And a commit "chore: human cleanup" that deletes ".gtd/DECISIONS.md"
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a commit "gtd: planning" that deletes ".gtd/TODO.md"
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: awaiting review"
    And a commit "gtd(human): review" that deletes ".gtd/REVIEW.md"
    And a commit "gtd: done"
    And a commit "gtd: squash template" that adds ".gtd/SQUASH_MSG.md" with:
      """
      chore: replace this template with a conventional-commits message
      """
    And the file ".gtd/DECISIONS.md" does not exist
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "Prior decisions"
    And stdout contains "Operation chaining"
