@inmem
Feature: Initial-state entry — every unrecognized HEAD lands at the initial state

  Pins `PatternMachine.resolveState` (see docs/design/pattern-machine-plan.md,
  decision 2/"initial: true") mostly against the bundled default workflow: a
  non-`gtd(actor): state` HEAD, an old v1/v2-style `gtd: <label>` subject, a
  state name the workflow doesn't declare, an actor the workflow doesn't
  declare, and a subject naming a commit (final) state all resolve to the
  initial state (`idle`) rather than erroring. The last scenario uses a minimal
  custom workflow to exercise the commit-state rule in isolation.

  Scenario: an ordinary non-gtd HEAD resolves to the initial state
    Given a test project
    And the workflow
    When I run gtd status
    Then it succeeds
    And stdout contains "State: idle"

  Scenario: an old v1/v2-style "gtd: <label>" subject resolves to the initial state
    Given a test project
    And the workflow
    And a commit "gtd: build" that adds ".gtd/TODO.md" with:
      """
      old two-namespace boundary commit
      """
    When I run gtd status
    Then it succeeds
    And stdout contains "State: idle"

  Scenario: a subject naming a state the workflow doesn't declare resolves to the initial state
    Given a test project
    And the workflow
    And a commit "gtd(human): frobnicate" that adds ".gtd/TODO.md" with:
      """
      a plan
      """
    When I run gtd status
    Then it succeeds
    And stdout contains "State: idle"

  Scenario: a subject naming an actor the workflow doesn't declare resolves to the initial state
    Given a test project
    And the workflow
    And a commit "gtd(nobody): planning" that adds ".gtd/TODO.md" with:
      """
      a plan
      """
    When I run gtd status
    Then it succeeds
    And stdout contains "State: idle"

  Scenario: a subject naming a commit (final) state resolves to the initial state
    # A minimal custom workflow with a `done` commit state exercises this
    # resolution rule in isolation.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "write NOTE.md to start a cycle"
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    And a commit "gtd(agent): done" that adds ".gtd/COMMIT_MSG.md" with:
      """
      feat: something
      """
    When I run gtd status
    Then it succeeds
    And stdout contains "State: idle"
