@inmem
Feature: gtd next --json --dispatch — the beat marker's stall detection

  `--dispatch` claims a beat is being handed to an executor: it arms/consumes a
  per-worktree marker (`<git dir>/gtd-beat`, `src/BeatMarker.ts`) so a `prompt`
  beat repeated verbatim — same state, same rendered content, same HEAD,
  meaning the agent's last turn changed nothing — reports `"stalled":true` and
  CONSUMES the marker, instead of being re-dispatched forever. Plain
  `gtd next --json` (no `--dispatch`) never touches the marker, since it is
  both polled (a status wrapper reading `.actor`) and peeked (a loop driver's
  opening move) — see the README's minimal driver's own `.stalled` guard.

  Background:
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
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "Build the package described below: write src/calc.ts exporting add(a, b)."
                on:
                  "* **": checking
              checking:
                actor: check
                script: "true"
                on:
                  "C": idle
      """

  Scenario: a re-dispatched prompt beat reports stalled and consumes the marker
    Given a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout does not contain "stalled"
    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"stalled\":true"

  Scenario: a plain --json peek between dispatches neither arms nor consumes the marker
    Given a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"
    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"stalled\":true"

  Scenario: a commit landing between dispatches reports no stall, even with identical prompt text
    Given a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    Given an empty commit "gtd(check): working"
    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout does not contain "stalled"

  Scenario: the stall report is single-shot — a third dispatch is clean again
    Given a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"stalled\":true"
    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout does not contain "stalled"

  Scenario: a check (script) beat never reports stalled, dispatched any number of times
    Given a commit "gtd(agent): checking" that adds "src/calc.ts" with:
      """
      export const add = (a, b) => a + b
      """
    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout does not contain "stalled"
    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout does not contain "stalled"
