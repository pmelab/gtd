@inmem
Feature: An invalid "workflow:" config fails loudly at load time, naming the state

  Pins `PatternConfig.compileWorkflowConfig` / `PatternMachine.validateDefinition`
  (see docs/design/pattern-machine-plan.md, "Validation"): a config-shape or
  definition problem is collected and thrown together, naming the offending
  state — never a silent fallback, and never deferred to step time.

  Scenario: a state declaring two content kinds fails naming the state
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "start"
            prompt: "also a prompt"
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "idle"
    And stderr contains "exactly one of"

  Scenario: an "on" edge targeting an undefined state fails naming both
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "start"
            on:
              "* **": nowhere
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "idle"
    And stderr contains "nowhere"

  Scenario: a state unreachable from the initial state fails naming it
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "start"
            on:
              "* **": done
          orphan:
            actor: human
            message: "no edge leads here"
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "orphan"
    And stderr contains "unreachable"

  Scenario: a content-kind violation and an unrelated "on" target both surface in one error
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "start"
            prompt: "also a prompt"
            on:
              "* **": nowhere
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "exactly one of"
    And stderr contains "nowhere"
