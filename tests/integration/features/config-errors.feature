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
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
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
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
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
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
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
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
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

  Scenario: a "mode:" naming no built-in and no declared mode fails, listing what is available
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            validate: "adr-lint <%= it.file %>"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                file: docs/adr.md
                mode: adrs
                on:
                  "* **": idle
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "\"mode\" must name a built-in mode (qa, review, prose)"
    And stderr contains "declared in \"modes\" (adr)"
    And stderr contains "got \"adrs\""

  Scenario: a "modes:" entry declaring neither format nor validate fails naming the mode
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr: {}
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": idle
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "mode \"adr\": must declare at least one of \"format\"/\"validate\""

  Scenario: an unknown key inside a "modes:" entry fails naming both
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          adr:
            validate: "adr-lint <%= it.file %>"
            lint: "also adr-lint"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": idle
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "mode \"adr\": unknown key(s) lint"

  Scenario: a malformed top-level "modes:" key fails the same way as a workflow-level one
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        qa:
          formatt: "npx prettier --write <%= it.file %>"
      """
    When I run gtd status
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "mode \"qa\": unknown key(s) formatt"

  Scenario: a top-level legacy "states:" key fails with the migration message, not downstream noise
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            message: "start"
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "top-level \"states:\" is no longer supported"
    And stderr contains "declare a machine under \"machines:\" and name it in \"entry.default:\""

  Scenario: a machine reference cycle fails naming the whole cycle
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: outer
        machines:
          outer:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": child
              child:
                machine: inner
          inner:
            entry: idle
            states:
              idle:
                actor: human
                message: "start2"
              back:
                machine: outer
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "machine reference cycle: outer → inner → outer"

  Scenario: a "machines:" entry declared but never referenced fails naming it
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
                message: "hi"
                on:
                  "* **": idle
          unused:
            entry: s
            states:
              s:
                actor: human
                message: "hi"
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "machine \"unused\" is declared but never referenced"

  Scenario: a sideways "on" target names the unbound-param remedy, not just "not a defined state"
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
                message: "hi"
                on:
                  "* **": nowhere
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "\"on\" target \"nowhere\" is not a state or reference of machine \"root\""
    And stderr contains "declare a \"params:\" entry and bind it at the reference site"
