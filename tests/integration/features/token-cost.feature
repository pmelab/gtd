@inmem
Feature: Token-cost tracking — gtd land --cost/--model persists per-turn cost, summed for the squash

  A loop driver knows how many tokens the invocation it just drove cost, and on
  which model. `gtd land --cost=<n> [--model=<name>]` records both as a
  `Gtd-Cost: <n> <model>` trailer on the turn commit (persisted in the git log,
  one per turn, subject line untouched). `computeProcessRun` collects every
  such entry across the current process; a `commit:` squash template renders
  the whole-process total via `it.processCost` and the per-model breakdown via
  `it.processCostByModel` — the complete cost of the feature, itemized by model,
  since tokens alone don't tell you the price. `gtd next` shows the running
  total (and per-model breakdown) mid-process — via its `--json` `cost`/
  `costByModel` fields when the resting state is a bare `prompt` (whose plain
  output carries no header at all).

  Scenario: gtd land --cost records a Gtd-Cost trailer on the turn commit, subject untouched
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
                message: "go"
                on:
                  "* **": building
              building:
                actor: agent
                prompt: "build it"
                on:
                  "* **": reviewing
              reviewing:
                actor: agent
                prompt: "review it"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): building" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "src/x.ts" with:
      """
      export const x = 1
      """
    When I run gtd land with "--cost=1450"
    Then it succeeds
    And the last commit subject is "gtd(agent): building → reviewing"
    And the last commit body contains "Gtd-Cost: 1450"

  Scenario: gtd land --cost records the cost, observable on the commit trailer, in plain text
    # No more --json here (land is plain-text only now, see AGENTS.md) — the
    # recorded cost is observable on the landed commit's own trailer, exactly
    # like this file's first scenario.
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
                message: "go"
                on:
                  "* **": building
              building:
                actor: agent
                prompt: "build it"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): building" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "src/x.ts" with:
      """
      export const x = 1
      """
    When I run gtd land with "--cost=1450"
    Then it succeeds
    And the last commit subject is "gtd(agent): building → idle"
    And the last commit body contains "Gtd-Cost: 1450"

  Scenario: gtd next --json shows the running process cost, accumulated across turns
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
                message: "go"
                on:
                  "* **": building
              building:
                actor: agent
                prompt: "build it"
                on:
                  "* **": reviewing
              reviewing:
                actor: agent
                prompt: "review it"
                on:
                  "* **": polishing
              polishing:
                actor: agent
                prompt: "polish it"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): building" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land with "--cost=100"
    Then it succeeds
    And the last commit subject is "gtd(agent): building → reviewing"
    Given a file "src/b.ts" with:
      """
      export const b = 2
      """
    When I run gtd land with "--cost=250"
    Then it succeeds
    And the last commit subject is "gtd(agent): reviewing → polishing"
    # polishing is a bare `prompt` state — plain `gtd next` output there drops
    # the header entirely (see AGENTS.md), so the running total is only
    # observable via --json's `cost` field.
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"polishing\""
    And stdout contains "\"cost\":350"

  Scenario: gtd next --json omits the cost field when no cost has been recorded
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
                message: "go"
                on:
                  "* **": building
              building:
                actor: agent
                prompt: "build it"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): building" that adds "NOTE.md" with:
      """
      a note
      """
    # building is a bare `prompt` state — plain `gtd next` output there drops
    # the header entirely, so check --json directly: the `cost` field is
    # omitted outright (never emitted as a zero) when nothing was recorded.
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"building\""
    And stdout does not contain "\"cost\""

  Scenario: a squash commit template renders it.processCost — the whole-process total including the squashing step
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
                message: "go"
                on:
                  "* **": building
              building:
                actor: agent
                prompt: "build it"
                on:
                  "* **": finishing
              finishing:
                actor: agent
                prompt: "write DONE.md"
                on:
                  "A DONE.md": done
                  "M DONE.md": done
              done:
                commit: |
                  feat: ship it

                  Total token cost: <%= it.processCost %>
      """
    And a commit "gtd(human): building" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land with "--cost=100"
    Then it succeeds
    And the last commit subject is "gtd(agent): building → finishing"
    And the last commit body contains "Gtd-Cost: 100"
    Given a file "DONE.md" with:
      """
      shipped
      """
    When I run gtd land with "--cost=250"
    Then it succeeds
    And the last commit subject is "feat: ship it"
    And the last commit body contains "Total token cost: 350"
    And the last commit body does not contain "Gtd-Cost:"

  Scenario: --cost is rejected on a non-land command
    Given a test project
    When I run gtd next with "--cost=5"
    Then it fails
    And stderr contains "gtd: --cost is only valid for `gtd land`"

  Scenario: a bare --cost (no value) is a usage error
    Given a test project
    When I run gtd land with "--cost"
    Then it fails
    And stderr contains "gtd: --cost requires a value"

  Scenario: a non-numeric --cost is a usage error
    Given a test project
    When I run gtd land with "--cost=lots"
    Then it fails
    And stderr contains "gtd: --cost must be a non-negative number"

  Scenario: gtd land --cost --model records the model alongside the cost in the trailer
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
                message: "go"
                on:
                  "* **": building
              building:
                actor: agent
                prompt: "build it"
                on:
                  "* **": reviewing
              reviewing:
                actor: agent
                prompt: "review it"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): building" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "src/x.ts" with:
      """
      export const x = 1
      """
    When I run gtd land with "--cost=1450" and "--model=claude-opus-4-8"
    Then it succeeds
    And the last commit subject is "gtd(agent): building → reviewing"
    And the last commit body contains "Gtd-Cost: 1450 claude-opus-4-8"

  Scenario: gtd land --cost --model records both, observable on the commit trailer, in plain text
    # No more --json here (land is plain-text only now, see AGENTS.md) — both
    # values land on the same Gtd-Cost trailer this file's earlier
    # "records the model alongside the cost" scenario already asserts on.
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
                message: "go"
                on:
                  "* **": building
              building:
                actor: agent
                prompt: "build it"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): building" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "src/x.ts" with:
      """
      export const x = 1
      """
    When I run gtd land with "--cost=1450" and "--model=opus"
    Then it succeeds
    And the last commit body contains "Gtd-Cost: 1450 opus"

  Scenario: gtd next --json shows the per-model breakdown under the running total
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
                message: "go"
                on:
                  "* **": building
              building:
                actor: agent
                prompt: "build it"
                on:
                  "* **": reviewing
              reviewing:
                actor: agent
                prompt: "review it"
                on:
                  "* **": polishing
              polishing:
                actor: agent
                prompt: "polish it"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): building" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land with "--cost=100" and "--model=haiku"
    Then it succeeds
    Given a file "src/b.ts" with:
      """
      export const b = 2
      """
    When I run gtd land with "--cost=250" and "--model=opus"
    Then it succeeds
    # polishing is a bare `prompt` state — plain `gtd next` output there drops
    # the header entirely, so the running total and per-model breakdown are
    # only observable via --json's `cost`/`costByModel` fields.
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"cost\":350"
    And stdout contains "\"model\":\"opus\",\"cost\":250"
    And stdout contains "\"model\":\"haiku\",\"cost\":100"

  Scenario: a squash commit template itemizes it.processCostByModel across the whole process
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
                message: "go"
                on:
                  "* **": building
              building:
                actor: agent
                prompt: "build it"
                on:
                  "* **": finishing
              finishing:
                actor: agent
                prompt: "write DONE.md"
                on:
                  "A DONE.md": done
                  "M DONE.md": done
              done:
                commit: |
                  feat: ship it

                  Total token cost: <%= it.processCost %>
                  <% it.processCostByModel.forEach(function(m){ %>
                  - <%= m.model %>: <%= m.cost %>
                  <% }) %>
      """
    And a commit "gtd(human): building" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land with "--cost=100" and "--model=haiku"
    Then it succeeds
    And the last commit subject is "gtd(agent): building → finishing"
    And the last commit body contains "Gtd-Cost: 100 haiku"
    Given a file "DONE.md" with:
      """
      shipped
      """
    When I run gtd land with "--cost=250" and "--model=opus"
    Then it succeeds
    And the last commit subject is "feat: ship it"
    And the last commit body contains "Total token cost: 350"
    And the last commit body contains "- opus: 250"
    And the last commit body contains "- haiku: 100"

  Scenario: --model is rejected on a non-land command
    Given a test project
    When I run gtd next with "--model=opus"
    Then it fails
    And stderr contains "gtd: --model is only valid for `gtd land`"

  Scenario: a bare --model (no value) is a usage error
    Given a test project
    When I run gtd land with "--model"
    Then it fails
    And stderr contains "gtd: --model requires a value"

  Scenario: --model without --cost is a usage error
    Given a test project
    When I run gtd land with "--model=opus"
    Then it fails
    And stderr contains "gtd: --model requires --cost"
