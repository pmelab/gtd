Feature: Grilling — the 3-way convergence gate on TODO.md

  TODO.md present (and not New Feature) is Grilling. It resolves three ways by
  the `<!-- user answers here -->` convergence marker and tree state: an open
  marker stops for the human, no marker + pending edits lets the agent iterate,
  and no marker + a clean tree converges to Grilled (`gtd: grilled`). Every round
  commits its pending tree as `gtd: grilling` first.

  Scenario: An open marker stops for the user to answer inline
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
    And stdout contains "## Task: Grill the plan in `TODO.md`"
    And stdout contains "Open questions await the user"
    And stdout does not contain "## Task: Decompose"

  Scenario: No marker but pending edits lets the grilling agent iterate
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And "TODO.md" is modified to:
      """
      # Plan

      Build a calculator with add and subtract.
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And stdout contains "## Task: Grill the plan in `TODO.md`"
    And stdout contains "### Develop the plan"

  Scenario: No marker and a clean tree converges to Grilled and prompts decompose
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator with add and subtract.

      no open questions — run gtd to plan
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    And stdout contains "## Task: Decompose the plan into work packages"
    And stdout does not contain "Open questions await the user"
