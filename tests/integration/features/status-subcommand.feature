@inmem
Feature: gtd status subcommand

  `gtd status` is a pure, read-only introspection command: it reports the
  current state, the next state, and any pending edge actions. It performs no
  git operations, runs no tests, writes no files, and emits no prompt. The
  `--json` flag switches output to a `StatusSummary` object.

  Scenario: Prompt-bearing state reports itself as next state (human-readable)
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a feature.

      ## What approach?

      <!-- user answers here -->
      """
    When I run gtd with args "status"
    Then it succeeds
    And stdout contains "State:"
    And stdout contains "grilling"
    And stdout contains "Next state:"

  Scenario: Edge-only state reports auto-advance and the edge action
    Given a test project
    And a file "REVIEW.md" with:
      """
      ## Review

      - [ ] Looks good
      """
    When I run gtd with args "status"
    Then it succeeds
    And stdout contains "auto-advances"
    And stdout contains "Edge actions:"
    And stdout contains "commit the review record"

  Scenario: --json emits the StatusSummary object
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a feature.

      ## What approach?

      <!-- user answers here -->
      """
    When I run gtd with args "status --json"
    Then it succeeds
    And stdout contains "\"state\""
    And stdout contains "\"nextState\""
    And stdout contains "\"willAutoAdvance\""
    And stdout contains "\"edgeActions\""
    And stdout does not contain "\"prompt\""

  Scenario: --json state field matches resolved state name (escalate)
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper function.
      """
    And a commit "gtd: errors" that adds "ERRORS.md" with:
      """
      The test suite failed three times: assertion mismatch on line 42.
      """
    When I run gtd with args "status --json"
    Then it succeeds
    And stdout contains "\"state\":\"escalate\""
    And stdout contains "\"nextState\":\"escalate\""

  Scenario: status performs no actions and prints no prompt
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper function.
      """
    Then I record the commit count
    When I run gtd with args "status"
    Then it succeeds
    And the commit count is unchanged
    And stdout does not contain "run `gtd`"

  Scenario: status rejects extra arguments
    Given a test project
    When I run gtd with args "status extra"
    Then it fails
    And stderr contains "gtd status: too many arguments"

  Scenario: status on an illegal steering-file combination reports the error
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper function.
      """
    And a file "ERRORS.md" with:
      """
      test failed
      """
    And a file "FEEDBACK.md" with:
      """
      a finding
      """
    And the working tree is committed as "feat: illegal combination"
    When I run gtd with args "status --json"
    Then it fails
    And stdout contains "\"state\":\"error\""
