@inmem
Feature: gtd next's three encodings (plain, --sh, --json) describe the same resolved rest

  `gtd next` resolves ONE rest through `renderRest`, and `program.ts`'s
  `gatherBeatFields` assembles the ONE `BeatFields` object that
  `renderBeatPlain`/`renderBeatSh`/`renderBeatJson` (`src/Beat.ts`) each render
  from — so the three encodings can never independently describe a different
  rest (there is only one command now; `gtd status` is gone). Plain `gtd next`
  wraps the step in a status-summary header at every kind except `prompt`
  (`renderBeatPlain`'s header-suppression rule) — those bytes are the agent's
  own input, so no header is prefixed there, and plain `gtd next`'s stdout
  (trailing newline aside) equals `--json`'s `content` field exactly. At every
  other kind, plain `gtd next` still ENDS WITH that same content, just with the
  header ahead of it. `--sh`'s own `gtd_content` variable carries the
  identical text too, proving the underlying `content` field — not merely the
  plain encoding — survives every encoder unchanged.

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
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": checking
              checking:
                actor: check
                script: "echo hi"
                on:
                  "C": idle
      """

  Scenario: a message rest — the initial gate before anything has happened
    When I run gtd with args "next"
    And I record stdout as "next-content"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout recorded as "next-content" ends with the current json field "content", trailing newline aside
    When I run gtd next with "--sh"
    Then it succeeds
    And stdout contains "gtd_content='write NOTE.md to start a process'"

  Scenario: a prompt rest, declaring no file/mode so next's self-validation suffix never applies
    Given a file "NOTE.md" with:
      """
      a note
      """
    And an empty commit "gtd(human): working"
    When I run gtd with args "next"
    And I record stdout as "next-content"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout recorded as "next-content" equals the current json field "content", trailing newline aside
    When I run gtd next with "--sh"
    Then it succeeds
    And stdout contains "gtd_content='do the work described in NOTE.md'"

  Scenario: a script rest
    Given a file "NOTE.md" with:
      """
      a note
      """
    And an empty commit "gtd(human): working"
    And an empty commit "gtd(agent): checking"
    When I run gtd with args "next"
    And I record stdout as "next-content"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout recorded as "next-content" ends with the current json field "content", trailing newline aside
    When I run gtd next with "--sh"
    Then it succeeds
    And stdout contains "gtd_content='echo hi'"
