@inmem
Feature: Driver protocol — gtd next --json content kinds, gtd status pattern matches

  Pins the `gtd next --json` contract (`{state, actor, kind, content, edges}`,
  see docs/design/pattern-machine-plan.md §3) for the `script` and `prompt`
  kinds — smoke.feature already pins the `message` kind at `idle` — the
  `edges` list (the resting state's `on` edges as `{pattern, target,
  describe?}`, also what a `message:` template sees as `it.edges`), and `gtd
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

  Scenario: gtd next --json carries the state's declared model hint, and gtd status shows it too
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
            model: smart
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
    And stdout contains "\"model\":\"smart\""
    When I run gtd status
    Then it succeeds
    And stdout contains "State: working"
    And stdout contains "Model: smart"
    When I run gtd status with "--json"
    Then it succeeds
    And stdout contains "\"model\":\"smart\""

  Scenario: gtd next --json and gtd status --json omit "model" entirely when the state declares none
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
    And stdout does not contain "\"model\""
    When I run gtd status
    Then it succeeds
    And stdout does not contain "Model:"
    When I run gtd status with "--json"
    Then it succeeds
    And stdout does not contain "\"model\""

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

  Scenario: gtd next --json and gtd status --json carry the state's declared file/mode, and plain gtd status shows both
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
            file: ".gtd/PLAN.md"
            mode: qa
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
    And stdout contains "\"file\":\".gtd/PLAN.md\""
    And stdout contains "\"mode\":\"qa\""
    When I run gtd status
    Then it succeeds
    And stdout contains "State: working"
    And stdout contains "File: .gtd/PLAN.md"
    And stdout contains "Mode: qa"
    When I run gtd status with "--json"
    Then it succeeds
    And stdout contains "\"file\":\".gtd/PLAN.md\""
    And stdout contains "\"mode\":\"qa\""

  Scenario: gtd next --json and gtd status --json omit "file"/"mode" entirely when the state declares neither
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
    And stdout does not contain "\"file\""
    And stdout does not contain "\"mode\""
    When I run gtd status
    Then it succeeds
    And stdout does not contain "File:"
    And stdout does not contain "Mode:"
    When I run gtd status with "--json"
    Then it succeeds
    And stdout does not contain "\"file\""
    And stdout does not contain "\"mode\""

  Scenario: a human gate's message renders its `on` edge descriptions as a route list, and gtd next --json carries the same edges
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          gate:
            actor: human
            initial: true
            message: |
              Decide what to do next.

              What each change does next (then run `gtd step human`):
              <% it.edges.forEach(function (e) { if (e.describe) { %>
              <%~ "- " + e.describe + "\n" %>
              <% } }) %>
            on:
              "C":
                to: accept
                describe: "Change nothing to accept the current state and proceed."
              "* **":
                to: revise
                describe: "Change any source file to leave feedback and start another round."
          accept:
            commit: "chore: accept"
          revise:
            actor: agent
            prompt: "revise"
            on:
              "* **": gate
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "What each change does next (then run `gtd step human`):"
    And stdout contains "- Change nothing to accept the current state and proceed."
    And stdout contains "- Change any source file to leave feedback and start another round."
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"pattern\":\"C\""
    And stdout contains "\"target\":\"accept\""
    And stdout contains "\"describe\":\"Change nothing to accept the current state and proceed.\""
    And stdout contains "\"target\":\"revise\""

  Scenario: a string-form `on` edge emits an edge with no describe, and gtd next --json omits "edges" for a commit-only-target state with none
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
              "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"edges\":[{\"pattern\":\"* **\",\"target\":\"idle\"}]"
    And stdout does not contain "\"describe\""
