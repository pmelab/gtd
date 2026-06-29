Feature: Build lifecycle — Grilled → Planning → Building

  Once the plan is grilled, decomposition writes `.gtd/` packages. A modified
  `.gtd/` commits `gtd: planning` and re-prompts decompose; a clean `.gtd/` under
  a `gtd: planning` HEAD selects the lowest-numbered package for Building and
  inlines only that package's tasks.

  Scenario: Modified .gtd under a gtd: grilled HEAD commits gtd: planning
    Given a test project
    And a commit "gtd: grilled" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a file ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: planning"
    And stdout contains "## Task: Decompose the plan into work packages"

  Scenario: A clean .gtd under a gtd: planning HEAD selects the lowest package to build
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    And a commit "gtd: planning" that adds ".gtd/02-sub/01-sub.md" with:
      """
      Implement the subtract function.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Build one work package"
    And stdout contains "01-add"
    And stdout contains "02-sub"
    # Only the lowest-numbered package's task content is inlined for building.
    And stdout contains "Implement the add function."
    And stdout does not contain "Implement the subtract function."
