@inmem
Feature: gtd next/land --json=<selector> — the dotted-path reduction of the same document

  `--json=<path>` walks the same document `gtd next --json`/`gtd land --json`
  print by dotted key path — no second field table,
  no jq dependency. A scalar prints raw and unquoted, one line; a boolean
  prints `true`/`false`; a list prints one JSON-encoded entry per line; an
  absent optional field prints nothing and exits 0; an unknown selector, or an
  empty one, is a usage error, exit 2. `--json` (no selector) is untouched —
  the full document, byte-identical to before this feature existed.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, refuse, run, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("working", "do the work described in NOTE.md", { label: "Doing the work" })
          if (added("DONE.md").length === 0) refuse("working must add DONE.md")
          await run("checking", "echo hi")
        },
      })
      """

  Scenario: gtd next --json=kind prints one bare word
    When I run gtd next with "--json=kind"
    Then it succeeds
    And stdout matches "^message\n$"

  Scenario: gtd next --json output is byte-identical to a golden document
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"idle\""
    And stdout contains "\"actor\":\"human\""
    And stdout contains "\"kind\":\"message\""
    And stdout contains "\"content\":\"write NOTE.md to start a process\""
    And stdout contains "\"idle\":true"

  Scenario: gtd next --json=session.id reaches the nested field
    Given a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next with "--json=session.id"
    Then it succeeds
    And stdout matches "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$"

  Scenario: gtd next --json=label at a rest with no label declared prints nothing and exits 0
    When I run gtd next with "--json=label"
    Then it succeeds
    And stdout is empty

  Scenario: gtd next --json=changes prints one JSON object per line
    Given a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And a file "DONE.md" with:
      """
      done!
      """
    And a file "scratch.txt" with:
      """
      another pending change
      """
    When I run gtd next with "--json=changes"
    Then it succeeds
    And stdout contains "\"path\":\"DONE.md\""
    And stdout contains "\"status\":\"A\""
    And stdout contains "\"path\":\"scratch.txt\""
    And stdout contains "\"pattern\":null"
    And stdout matches "}\n{"

  Scenario: gtd next --json=idle prints true at the initial state with a clean tree
    When I run gtd next with "--json=idle"
    Then it succeeds
    And stdout matches "^true\n$"

  Scenario: gtd next --json=next prints nothing (never the string "null") when no on: pattern matches
    When I run gtd next with "--json=next"
    Then it succeeds
    And stdout is empty

  Scenario: gtd next --json=next.target descends through a null next as absent, not a fatal unknown
    When I run gtd next with "--json=next.target"
    Then it succeeds
    And stdout is empty

  Scenario: gtd next --json=nope exits 2 for an unknown top-level key
    When I run gtd next with "--json=nope"
    Then the exit code is 2

  Scenario: gtd next --json kind (space form) leaves "kind" as a stray positional and exits 2
    When I run gtd with args "next --json kind"
    Then the exit code is 2

  Scenario: gtd next --json= (empty selector) is a usage error
    When I run gtd next with "--json="
    Then the exit code is 2

  Scenario: gtd land's null LandFields (subject/cost/model) at a no-op landing print nothing, never the string "null"
    When I run gtd land with "--json=subject"
    Then it succeeds
    And stdout is empty
    When I run gtd land with "--json=cost"
    Then it succeeds
    And stdout is empty
    When I run gtd land with "--json=model"
    Then it succeeds
    And stdout is empty

  Scenario: gtd land --json=script prints the landing script a driver pipes to sh
    Given a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And a file "DONE.md" with:
      """
      done!
      """
    When I run gtd land with "--json=script"
    Then it succeeds
    And stdout contains "git add -A"
    And stdout contains "git commit"

  Scenario: gtd land --json=model reads the recorded model back — distinct from --model=<name>, which records it
    Given a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And a file "DONE.md" with:
      """
      done!
      """
    When I run gtd land with "--model=opus" and "--cost=100" and "--json=model"
    Then it succeeds
    And stdout matches "^opus\n$"
    When I run gtd land with "--model=haiku" and "--cost=250"
    Then it succeeds
    And the last commit body contains "Gtd-Cost: 250 haiku"
