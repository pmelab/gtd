@inmem
Feature: gtd step-agent — the agent mutator

  `gtd step-agent` runs the same engine as `gtd step` but only performs the
  agent's turn. While the machine awaits a human, it refuses: exit non-zero,
  zero commits, and stderr names the human turn it is waiting on. An empty
  agent turn is inert — it is recorded once (so `gtd next` re-emits the same
  agent prompt) and a second clean run authors nothing further.

  Scenario: Refuses while a human turn is awaited
    Given a test project
    And a commit "gtd(agent): grilling" that adds "TODO.md" with:
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

  Scenario: An empty agent turn is recorded once and next re-emits the same prompt
    Given a test project
    And a commit "gtd(human): grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.

      no open questions — run gtd to plan
      """
    When I run gtd step-agent
    Then it succeeds
    And the last commit subject is "gtd(agent): grilling"
    When I run gtd next
    Then it succeeds
    And stdout contains "Finish your turn by running `gtd step-agent`."
    Then I record the commit count
    When I run gtd step-agent
    Then it succeeds
    And the commit count is unchanged

  Scenario: A normal agent turn captures dirty TODO.md and leaves the tree clean
    Given a test project
    And a commit "gtd(human): grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And "TODO.md" is modified to:
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
