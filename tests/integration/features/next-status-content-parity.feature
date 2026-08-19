@inmem
Feature: gtd next's content equals gtd status --json's content field

  `gtd next` is now plain text only, and `gtd status --json` absorbed the beat
  document (see AGENTS.md's "one structured surface" decision) — both read the
  SAME resolved rest through the SAME `renderRest`, gathered by one shared
  helper (`program.ts`'s `gatherStatusView`), so the two surfaces can never
  independently describe a different rest. This pins that invariant directly:
  `gtd next`'s stdout (trailing newline aside) equals `jq -r .content` of
  `gtd status --json` at the exact same rest.

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
    When I run gtd status with "--json"
    Then stdout recorded as "next-content" equals the current json field "content", trailing newline aside

  Scenario: a prompt rest, declaring no file/mode so next's self-validation suffix never applies
    Given a file "NOTE.md" with:
      """
      a note
      """
    And an empty commit "gtd(human): working"
    When I run gtd with args "next"
    And I record stdout as "next-content"
    When I run gtd status with "--json"
    Then stdout recorded as "next-content" equals the current json field "content", trailing newline aside

  Scenario: a script rest
    Given a file "NOTE.md" with:
      """
      a note
      """
    And an empty commit "gtd(human): working"
    And an empty commit "gtd(agent): checking"
    When I run gtd with args "next"
    And I record stdout as "next-content"
    When I run gtd status with "--json"
    Then stdout recorded as "next-content" equals the current json field "content", trailing newline aside
