Feature: gtd summary — prints the closing-message prompt, writing nothing

  `gtd summary` replaces the old squash finale: instead of collapsing a
  finished process's turn commits into one, it prints a prompt for an agent
  to write the process's own closing message — naming the entry commit, every
  human-authored commit in the trace (a review round's own edit, an answered
  question gate — derived generically by invoking actor, never by naming a
  state), a diff range to inspect, and the process cost, total and per model.
  It writes NOTHING: no git, no filesystem, no state transition, no session
  identity (no `gtd_session_id`, no resume flag, no model, no system prompt).
  It refuses when the active workflow declares no `summary` option, or
  when the resolved run has an empty trace (nothing to summarize at HEAD).

  @inmem
  Scenario: gtd summary names the entry commit and every human-authored commit, carrying the message instructions
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, refuse, workflow } from "@pmelab/gtd/flows"

      const summary = (it) =>
        [
          "The process is closed. Write its closing message.",
          "",
          `Entry: ${it.entryCommit}`,
          ...it.humanCommits.map((c) => `Human: ${c.hash} entering ${c.state}`),
          `Range: ${it.processBase}..${it.processTip}`,
        ].join("\n")

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
        await human("gate", { message: "confirm before finishing" })
        await agent("finishing", "write DONE.md")
        if (!changes("DONE.md").some((c) => c.status !== "deleted")) {
          refuse("finishing must write DONE.md")
        }
      }, { summary })
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"
    And I mark the current commit as "entry"
    And I run the pin beat

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
    And the last commit subject is "gtd(agent): finishing → gtd:unpin"
    And I run the unpin beat

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

  @inmem
  Scenario: gtd summary writes nothing — the repository is byte-identical before and after the call
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      const summary = (it) => `Closing message for ${it.entryCommit}..${it.processTip}.`

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      }, { summary })
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"
    And I run the pin beat

    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → gtd:unpin"
    And I run the unpin beat

    Given the git index has settled
    And I snapshot the repository
    When I run gtd with args "summary"
    Then it succeeds
    And stdout contains "Closing message for"
    And the repository snapshot is unchanged

  @inmem
  Scenario: gtd summary refuses on a fresh idle repo — nothing to summarize
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      const summary = (it) => `Closing message for ${it.entryCommit}.`

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      }, { summary })
      """
    When I run gtd with args "summary"
    Then it fails
    And stdout is empty
    And stderr contains "gtd summary: refused"

  @inmem
  Scenario: gtd summary refuses when the active workflow declares no summary: template
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      }
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And I run the pin beat
    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → gtd:unpin"
    And I run the unpin beat

    When I run gtd with args "summary"
    Then it fails
    And stdout is empty
    And stderr contains "gtd summary: refused"

  @inmem
  Scenario: gtd summary exposes every process mark, oldest first, to the workflow's summary
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, mark, workflow } from "@pmelab/gtd/flows"

      const summary = (it) => it.marks.map((m) => `${m.name}=${m.value}`).join(" | ")

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        mark("risk-tier", "high")
        mark("production-signal", "error rate")
        await agent("building", "build it")
        mark("production-signal", "p95 latency")
        await agent("checking", "check it")
      }, { summary })
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"
    And I run the pin beat

    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → checking"

    When I run gtd with args "summary"
    Then it succeeds
    And stdout contains "risk-tier=high | production-signal=error rate | production-signal=p95 latency"
