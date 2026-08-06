@inmem
Feature: Initial-state entry — every unrecognized HEAD lands at the initial state

  Pins `PatternMachine.resolveState` (see docs/design/pattern-machine-plan.md,
  decision 2/"initial: true") mostly against the bundled default workflow: a
  non-`gtd(actor): state` HEAD, an old v1/v2-style `gtd: <label>` subject, an
  actor the workflow doesn't declare, and a subject naming a commit (final)
  state all resolve to the initial state (`idle`) rather than erroring. The
  last scenario uses a minimal custom workflow to exercise the commit-state
  rule in isolation.

  A state name the workflow doesn't declare AT ALL is the one exception
  (`src/Edge.ts`'s `resolveRest`, package 06): that specific shape means an
  in-flight process got renamed/removed out from under it by a workflow
  change, so it refuses loudly (pointing at `gtd abandon`) rather than
  silently looking like a fresh, idle repo.

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

  Scenario: a subject naming a state the workflow doesn't declare AT ALL refuses, pointing at `gtd abandon`
    Given a test project
    And the workflow
    And a commit "gtd(human): frobnicate" that adds ".gtd/TODO.md" with:
      """
      a plan
      """
    When I run gtd status
    Then it fails
    And stderr contains "frobnicate"
    And stderr contains "gtd abandon"

  Scenario: a subject naming an actor the workflow doesn't declare resolves to the initial state
    Given a test project
    And the workflow
    And a commit "gtd(nobody): plan.planning" that adds ".gtd/TODO.md" with:
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
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
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
