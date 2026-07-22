@live
Feature: gtd run — the built-in script driver

  Pins `gtd run` (see docs/design/pattern-machine-plan.md §3): it executes the
  resolved rest's emitted script verbatim, then steps that state's own actor
  to capture the outcome — real subprocess execution, so this feature runs
  `@live`. It refuses outright when the resolved rest isn't a script.

  Scenario: gtd run executes the resolved script and steps its actor, driving a transition
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
              "* **": checking
          checking:
            actor: check
            script: |
              #!/usr/bin/env bash
              touch DONE.md
            on:
              "A DONE.md": finished
          finished:
            actor: human
            message: "done"
      """
    And a commit "gtd(human): checking" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd run
    Then it succeeds
    And "DONE.md" exists
    And the last commit subject is "gtd(check): finished"

  Scenario: gtd run refuses when the resolved rest isn't a script
    Given a test project
    When I run gtd run
    Then it fails
    And stderr contains "gtd run:"
    And stderr contains "\"idle\""
    And stderr contains "nothing scripted to run"
