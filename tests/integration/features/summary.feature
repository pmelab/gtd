Feature: gtd summary — prints the closing-message prompt, writing nothing

  `gtd summary` replaces the old squash finale: instead of collapsing a
  finished process's turn commits into one, it prints a prompt for an agent
  to write the process's own closing message — naming the entry commit, every
  human-authored commit in the trace (a review round's own edit, an answered
  question gate — derived generically by invoking actor, never by naming a
  state), a diff range to inspect, and `it.processCost`/`it.processCostByModel`.
  It writes NOTHING: no git, no filesystem, no state transition, no session
  identity (no `gtd_session_id`, no resume flag, no model, no system prompt).
  It refuses when the active workflow declares no `summary:` template, or
  when the resolved run has an empty trace (nothing to summarize at HEAD).

  @inmem
  Scenario: gtd summary names the entry commit and every human-authored commit, carrying the message instructions
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        summary: |
          The process is closed. Write its closing message.

          Entry: <%= it.entryCommit %>
          <% it.humanCommits.forEach(function (c) { %>
          Human: <%= c.hash %> entering <%= c.state %>
          <% }) %>
          Range: <%= it.processBase %>..<%= it.processTip %>
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": building
              building:
                actor: agent
                prompt: "build it"
                on:
                  "* **": gate
              gate:
                actor: human
                message: "confirm before finishing"
                on:
                  "* **": finishing
              finishing:
                actor: agent
                prompt: "write DONE.md"
                on:
                  "A DONE.md": idle
                  "M DONE.md": idle
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"
    And I mark the current commit as "entry"

    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → gate"

    Given a file "src/b.ts" with:
      """
      export const b = 2
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): gate → finishing"
    And I mark the current commit as "gate-confirm"

    Given a file "DONE.md" with:
      """
      done
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): finishing → idle"

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"idle\":true"

    When I run gtd with args "summary"
    Then it succeeds
    And stdout contains "The process is closed. Write its closing message."
    And stdout contains the hash of "entry"
    And stdout contains the hash of "gate-confirm"
    And stdout contains "entering finishing"
    # the entry commit itself is human-authored too, but it IS entryCommit —
    # deduped, never listed a second time under humanCommits.
    And stdout does not contain "entering building"

  @live
  Scenario: gtd summary writes nothing — the repository is byte-identical before and after the call
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        summary: |
          Closing message for <%= it.entryCommit %>..<%= it.processTip %>.
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": building
              building:
                actor: agent
                prompt: "build it"
                on:
                  "* **": idle
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"

    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → idle"

    Given the git index has settled
    And I snapshot the repository
    When I run gtd with args "summary"
    Then it succeeds
    And stdout contains "Closing message for"
    And the repository snapshot is unchanged

  @inmem
  Scenario: gtd summary refuses on a fresh idle repo — nothing to summarize
    Given a test project
    And the workflow
    When I run gtd with args "summary"
    Then it fails
    And stdout is empty
    And stderr contains "gtd summary: refused"

  @inmem
  Scenario: gtd summary refuses when the active workflow declares no summary: template
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
                  "* **": building
              building:
                actor: agent
                prompt: "build it"
                on:
                  "* **": idle
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → idle"

    When I run gtd with args "summary"
    Then it fails
    And stdout is empty
    And stderr contains "gtd summary: refused"
