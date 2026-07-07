Feature: In-process in-memory tier smoke test

  Proves the @inmem tier runs the gtd program in-process against the in-memory
  layers. These scenarios are tagged @inmem so they run via Effect.runPromise
  instead of the live spawnSync path. They are functionally identical to the
  corresponding live-tier scenarios — only the execution backend differs.

  @inmem
  Scenario: Grilling prompt is emitted in-process against in-memory layers
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      <!-- user answers here -->
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And stdout contains "holds the plan under development"
    And stdout contains "Open questions await the user"

  @inmem
  Scenario: Second in-process run shows no newline bleed from previous scenario
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a feature.

      ## What approach?

      <!-- user answers here -->
      """
    When I run gtd
    Then it succeeds
    And stdout contains "holds the plan under development"
