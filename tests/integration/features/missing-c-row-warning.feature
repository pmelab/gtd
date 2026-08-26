@inmem
Feature: gtd warns on a workflow state that declares no "C" row

  `validateDefinition` (src/PatternMachine.ts) warns — never errors — when a
  non-`prompt`, non-initial state declares no `C` row: a clean tree there is a
  legitimate no-op by design (AGENTS.md's step-capture default), but usually an
  oversight. Every command that loads workflow state (`needsOf` `"state"`)
  prints the warning once per invocation, on stderr only — stdout stays the
  machine path. The bundled unified template ships none.

  Background:
    Given a test project

  Scenario: a non-prompt, non-initial state with no "C" row prints exactly one warning naming it, on stderr
    Given a gtd config file at ".gtdrc" with:
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
                message: "go"
                on:
                  "* **": building
              building:
                actor: check
                script: |
                  #!/usr/bin/env sh
                  exit 0
                on:
                  "A foo.txt": idle
      """
    When I run gtd with args "next"
    Then it succeeds
    And stderr contains "state \"building\" declares no \"C\" row" exactly 1 times
    And stdout does not contain "\"C\" row"

  Scenario: the bundled unified template prints no such warning
    Given the workflow
    When I run gtd with args "next"
    Then it succeeds
    And stderr does not contain "\"C\" row"

