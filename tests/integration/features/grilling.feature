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

  Scenario: Marker inside an unclosed code fence does not stop for the user
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.

      ```
      <!-- user answers here -->
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    And stdout does not contain "Open questions await the user"

  Scenario: Marker inside a closed code fence is ignored
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.

      ```
      <!-- user answers here -->
      ```
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    And stdout does not contain "Open questions await the user"

  Scenario: A .gtd package file whose name contains a space is classified as gtd, not code
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-feature/my task.md" with:
      """
      - [ ] implement the thing
      """
    And ".gtd/01-feature/my task.md" is modified to:
      """
      - [x] implement the thing
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: planning"
    And stdout does not contain "## Task: Run tests"
