@inmem
Feature: JSON output mode

  The --json flag switches the default command from plain-text prompts to a
  single-line JSON object { state, autoAdvance, prompt }. The format subcommand
  rejects --json with a clear error.

  Scenario: Prompt-bearing state emits a JSON object with state and autoAdvance fields
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a feature.

      ## What approach?

      <!-- user answers here -->
      """
    When I run gtd with "--json"
    Then it succeeds
    And stdout contains "\"state\""
    And stdout contains "\"autoAdvance\""
    And stdout contains "\"prompt\""

  Scenario: Auto-advance state emits autoAdvance true and no tail markers
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper function.
      """
    When I run gtd with "--json"
    Then it succeeds
    And stdout contains "\"autoAdvance\":true"
    And stdout does not contain "run `gtd`"
    And stdout does not contain "This is a human feedback gate"

  Scenario: Human-gate state emits autoAdvance false and no stop marker in stdout
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper function.
      """
    And a commit "gtd: errors" that adds "ERRORS.md" with:
      """
      The test suite failed three times: assertion mismatch on line 42.
      """
    When I run gtd with "--json"
    Then it succeeds
    And stdout contains "\"autoAdvance\":false"
    And stdout does not contain "This is a human feedback gate"

  Scenario: State field in JSON output matches the resolved state name
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper function.
      """
    And a commit "gtd: errors" that adds "ERRORS.md" with:
      """
      The test suite failed three times: assertion mismatch on line 42.
      """
    When I run gtd with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"escalate\""

  Scenario: JSON prompt does not contain a bare gtd re-run instruction
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper function.
      """
    When I run gtd with "--json"
    Then it succeeds
    And stdout does not contain "re-run gtd"

  # The in-memory tier cannot simulate a non-repository path because the inmem
  # GitService always returns "/repo" as topLevel and the inmem FileSystem's
  # realPath returns "/repo" for every path, so the cwd guard never fires.
  # An illegal steering-file combination (ERRORS.md + FEEDBACK.md) is used
  # instead to trigger the error path at the machine level.
  Scenario: Error state emits state error and exits non-zero
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
    When I run gtd with "--json"
    Then it fails
    And stdout contains "\"state\":\"error\""

  Scenario: format subcommand rejects --json flag
    Given a test project
    And a file "TODO.md" with:
      """
      # Plan
      """
    When I run gtd with args "format --json"
    Then it fails
    And stderr contains "does not accept --json"
