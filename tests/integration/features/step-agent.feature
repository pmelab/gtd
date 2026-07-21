@inmem
Feature: gtd step-agent — the agent mutator

  `gtd step-agent` runs the same engine as `gtd step` but only performs the
  agent's turn. While the machine awaits a human, it refuses: exit non-zero,
  zero commits, and stderr names the human turn it is waiting on. An empty
  agent turn is inert — it is recorded once (so `gtd next` re-emits the same
  agent prompt) and a second clean run authors nothing further.

  Scenario: Refuses while a human turn is awaited
    Given a test project
    And a commit "gtd(agent): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      <!-- user answers here -->
      """
    Then I record the commit count
    When I run gtd step-agent
    Then it fails
    And stderr contains "awaits a human turn"
    And the commit count is unchanged

  Scenario: A do-nothing agent invocation is inert and next re-emits the same prompt
    Given a test project
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.

      no open questions — run gtd to plan
      """
    Then I record the commit count
    When I run gtd step-agent
    Then it succeeds
    And the commit count is unchanged
    And the last commit subject is "gtd(human): grilling"
    When I run gtd next
    Then it succeeds
    And stdout contains "Finish your turn by running `gtd step-agent`."
    When I run gtd step-agent
    Then it succeeds
    And the commit count is unchanged

  Scenario: A normal agent turn captures dirty TODO.md and leaves the tree clean
    Given a test project
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And ".gtd/TODO.md" is modified to:
      """
      # Plan

      Build a calculator with add and subtract.
      """
    When I run gtd step-agent
    Then it succeeds
    And the last commit subject is "gtd(agent): grilling"
    Then I record the commit count
    # The agent's capture was non-empty (real answers, not an accepting empty
    # turn), so per the grilling contract this lands on the human-answer
    # gate: the AGENT's own turn commit is non-empty, so the next turn is
    # awaited from the human, not the agent. A further gtd step-agent here
    # must be refused as out-of-turn, not treated as an idempotent no-op.
    When I run gtd step-agent
    Then it fails
    And stderr contains "awaits a human turn"
    And the commit count is unchanged

  Scenario: A do-nothing agent invocation at the grilled rest never consumes the architecture
    Given a test project
    And a commit "gtd(human): architecting" that adds ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Build a calculator.
      """
    And a commit "gtd: grilled"
    Then I record the commit count
    When I run gtd step-agent
    Then it succeeds
    And the commit count is unchanged
    And the file ".gtd/ARCHITECTURE.md" exists
    And the git log does not contain "gtd: building"
    When I run gtd next
    Then it succeeds
    And stdout contains "Decompose it into an ordered set of"

  Scenario: A historical decompose turn without packages rests instead of deleting the architecture
    Given a test project
    And a commit "gtd(human): architecting" that adds ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Build a calculator.
      """
    And a commit "gtd: grilled"
    And a commit "gtd(agent): grilled"
    Then I record the commit count
    When I run gtd step-agent
    Then it succeeds
    And the commit count is unchanged
    And the file ".gtd/ARCHITECTURE.md" exists
    And the git log does not contain "gtd: building"

  Scenario: A do-nothing agent invocation at the planning rest never skips the build
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    Then I record the commit count
    When I run gtd step-agent
    Then it succeeds
    And the commit count is unchanged
    And the git log does not contain "gtd: tests-green"
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
