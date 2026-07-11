Feature: In-process in-memory tier smoke test

  Proves the @inmem tier runs the gtd program in-process against the in-memory
  layers. These scenarios are tagged @inmem so they run via Effect.runPromise
  instead of the live spawnSync path. They are functionally identical to the
  corresponding live-tier scenarios — only the execution backend differs.

  @inmem
  Scenario: The human-answer prompt is emitted in-process against in-memory layers
    Given a test project
    And a commit "gtd(agent): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      Suggested default: add and subtract.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    When I run gtd next
    Then it succeeds
    And stdout contains ".gtd/TODO.md"

  @inmem
  Scenario: Second in-process run shows no newline bleed from previous scenario
    Given a test project
    And a commit "gtd(agent): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a feature.

      ## What approach?

      Suggested default: incremental delivery.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains ".gtd/TODO.md"
