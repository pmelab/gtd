@inmem
Feature: Driver protocol — gtd next --json content kinds, gtd status pattern matches

  Pins the `gtd next --json` contract (`{state, actor, kind, content}`, see
  docs/design/pattern-machine-plan.md §3) for the `script` and `prompt` kinds
  — smoke.feature already pins the `message` kind at `idle` — and `gtd
  status`'s pattern-match reporting (plain text and `--json`), which shows
  which declared `on` pattern (if any) each pending change matches.

  Scenario: gtd next --json reports kind "script" for a check-actor state
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
            script: "echo hi"
            on:
              "C": idle
      """
    And a commit "gtd(human): checking" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"checking\""
    And stdout contains "\"actor\":\"check\""
    And stdout contains "\"kind\":\"script\""
    And stdout contains "echo hi"

  Scenario: gtd next --json reports kind "prompt" for an agent-actor state
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
              "* **": working
          working:
            actor: agent
            prompt: "do the work described in NOTE.md"
            on:
              "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "\"kind\":\"prompt\""
    And stdout contains "do the work described in NOTE.md"

  Scenario: gtd status prints which declared pattern each pending change matches
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "go"
            on:
              "* **": working
          working:
            actor: agent
            prompt: "..."
            on:
              "A DONE.md": done
              "M .gtd/FEEDBACK.md": fixing
          fixing:
            actor: agent
            prompt: "..."
            on:
              "* **": working
          done:
            commit: "chore: done"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "DONE.md" with:
      """
      done!
      """
    And a file "scratch.txt" with:
      """
      not matched by any pattern
      """
    When I run gtd status
    Then it succeeds
    And stdout contains "State: working"
    And stdout contains "Awaits: agent"
    And stdout contains "A DONE.md -> A DONE.md"
    And stdout contains "A scratch.txt -> (no match)"

  Scenario: gtd status --json reports the same pattern matches structurally
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "go"
            on:
              "* **": working
          working:
            actor: agent
            prompt: "..."
            on:
              "A DONE.md": done
          done:
            commit: "chore: done"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "DONE.md" with:
      """
      done!
      """
    And a file "scratch.txt" with:
      """
      not matched by any pattern
      """
    When I run gtd status with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"pattern\":\"A DONE.md\""
    And stdout contains "\"pattern\":null"
