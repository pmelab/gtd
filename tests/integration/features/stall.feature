@inmem
Feature: gtd next --json — attempt commits and the derived stall

  A no-change agent turn is now VISIBLE: a `prompt` beat whose step lands a
  clean tree and declares no `C` row commits an empty `gtd(<actor>): <state>`
  attempt instead of the old silent no-op. `stalled` is derived from that
  history — HEAD is an empty attempt at the resting state, the tree is clean,
  and another dispatch would just repeat it (see `Edge.ts`'s `stalledAt`) — a
  pure read `gtd next --json` reports on EVERY call, dispatched or not,
  sticky until the workflow's own `C` row or `retry:` escalation clears it.

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

  Scenario: an agent turn that changes nothing lands an empty attempt, and the next read reports stalled
    Given a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working"
    And the git status is clean
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"stalled\":true"

  Scenario: before the attempt lands, the same beat reports no stall
    Given a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"

  Scenario: a prompt state declaring "C" commits its C target instead — never an attempt, never stalled
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
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "Build the package described below: write src/calc.ts exporting add(a, b)."
                on:
                  "A DONE.md": checking
                  "C": checking
              checking:
                actor: check
                script: "true"
                on:
                  "C": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → checking"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"

  Scenario: retry redirects the escalating attempt once its cap is reached, clearing the stall
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
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                retry:
                  max: 2
                  otherwise: escalate
                prompt: "Build the package described below: write src/calc.ts exporting add(a, b)."
                on:
                  "A DONE.md": checking
              escalate:
                actor: human
                message: "stuck — the agent made no progress"
                on:
                  "* **": checking
              checking:
                actor: check
                script: "true"
                on:
                  "C": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → escalate"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"

  Scenario: a dirty tree suppresses the stall report
    Given a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working"
    Given a file "scratch.md" with:
      """
      not yet committed
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"

  Scenario: a script rest's clean step is still a plain no-op — never an attempt, never stalled
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
                  "A FEEDBACK.md": working
      """
    And a commit "gtd(agent): checking" that adds "src/calc.ts" with:
      """
      export const add = (a, b) => a + b
      """
    When I run gtd land
    Then it settles
    And stdout contains "nothing to do at \"checking\""
    And the last commit subject is "gtd(agent): checking"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"

  Scenario: a message rest's clean step is still a plain no-op — never an attempt, never stalled
    When I run gtd land
    Then it succeeds
    And stdout contains "nothing to do at \"idle\""
    And the last commit subject is "chore: add .gtdrc"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"
