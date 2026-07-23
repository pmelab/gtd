@inmem
Feature: Token-cost tracking — gtd step --cost persists a per-turn cost, summed for the squash

  A loop driver knows how many tokens the invocation it just drove cost.
  `gtd step <actor> --cost=<n>` records that number as a `Gtd-Cost: <n>`
  trailer on the turn commit (persisted in the git log, one per turn, subject
  line untouched). `computeProcessRun` sums every such trailer across the
  current process into `it.processCost`, so a `commit:` squash template can
  print the whole-process total — the complete token cost of the feature — and
  `gtd status` can show the running total mid-cycle.

  Scenario: gtd step --cost records a Gtd-Cost trailer on the turn commit, subject untouched
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
    When I run gtd step agent with "--cost=1450"
    Then it succeeds
    And the last commit subject is "gtd(agent): reviewing"
    And the last commit body contains "Gtd-Cost: 1450"

  Scenario: gtd step --json echoes the recorded cost
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
    When I run gtd step agent with "--cost=1450" and "--json"
    Then it succeeds
    And stdout contains "\"subject\":\"gtd(agent): idle\""
    And stdout contains "\"cost\":1450"

  Scenario: gtd status shows the running process cost, accumulated across turns
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
    When I run gtd step agent with "--cost=100"
    Then it succeeds
    And the last commit subject is "gtd(agent): reviewing"
    Given a file "src/b.ts" with:
      """
      export const b = 2
      """
    When I run gtd step agent with "--cost=250"
    Then it succeeds
    And the last commit subject is "gtd(agent): polishing"
    When I run gtd status
    Then it succeeds
    And stdout contains "State: polishing"
    And stdout contains "Cost: 350"

  Scenario: gtd status omits the Cost line when no cost has been recorded
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
    When I run gtd status
    Then it succeeds
    And stdout contains "State: building"
    And stdout does not contain "Cost:"

  Scenario: a squash commit template renders it.processCost — the whole-process total including the squashing step
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
    When I run gtd step agent with "--cost=100"
    Then it succeeds
    And the last commit subject is "gtd(agent): finishing"
    And the last commit body contains "Gtd-Cost: 100"
    Given a file "DONE.md" with:
      """
      shipped
      """
    When I run gtd step agent with "--cost=250"
    Then it succeeds
    And the last commit subject is "feat: ship it"
    And the last commit body contains "Total token cost: 350"
    And the last commit body does not contain "Gtd-Cost:"

  Scenario: --cost is rejected on a non-step command
    Given a test project
    When I run gtd status with "--cost=5"
    Then it fails
    And stderr contains "gtd: --cost is only valid for `gtd step`"

  Scenario: a bare --cost (no value) is a usage error
    Given a test project
    When I run gtd step agent with "--cost"
    Then it fails
    And stderr contains "gtd: --cost requires a value"

  Scenario: a non-numeric --cost is a usage error
    Given a test project
    When I run gtd step agent with "--cost=lots"
    Then it fails
    And stderr contains "gtd: --cost must be a non-negative number"
