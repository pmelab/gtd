@inmem
Feature: Reads are safe to poll — a settled rest answers identically and mutates nothing

  `gtd next` must be safe to poll: nothing may move between
  the run that reports a rest and any following call. Session id and resume
  are a pure derivation of history and write nothing, and no command records
  that a beat was dispatched — largely guaranteed already, but a gap in
  proof. These scenarios assert it directly against the repository, at
  both a resting PROMPT turn (where `gtd next --json` derives
  `session`/`memory`/`model` — the very properties the requirement names —
  the one structured surface gtd has now, see AGENTS.md)
  and a resting human GATE, so a future change cannot quietly reintroduce a
  driver-scoped write at either shape. A third scenario is a negative
  control: without it, the snapshot helper could stop observing anything at
  all and every "unchanged" assertion above would still pass vacuously. That
  no git read writes to a real git dir is the git port's own contract.

  Scenario: repeated reads at a resting prompt turn change nothing — session, memory, and model all stay put
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "develop the note", { model: "smart" })
        await human("waiting", { message: "answer the open question" })
      }

      export const fix = async () => {
        await agent("fixing", "Fix it.")
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → working"
    And the git index has settled
    And I snapshot the repository
    When I run gtd next with "--json"
    Then it succeeds
    And I record stdout as "status-1"
    And stdout contains "\"session\":"
    And stdout contains "\"memory\":"
    And stdout contains "\"model\":"
    When I run gtd next with "--json"
    Then it succeeds
    And I record stdout as "status-2"
    Then stdout recorded as "status-1" is byte-identical to stdout recorded as "status-2"
    And the repository snapshot is unchanged

  Scenario: repeated reads at a settled gate change nothing
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "develop the note", { model: "smart" })
        await human("waiting", { message: "answer the open question" })
      }

      export const fix = async () => {
        await agent("fixing", "Fix it.")
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → working"
    And a file "notes/sketch.md" with:
      """
      the developed sketch
      """
    And gtd lands "gtd(agent): working → waiting"
    And the git index has settled
    And I snapshot the repository
    When I run gtd next with "--json"
    Then it succeeds
    And I record stdout as "status-1"
    When I run gtd next
    Then it succeeds
    And I record stdout as "next-1"
    When I run gtd next with "--json"
    Then it succeeds
    And I record stdout as "status-2"
    When I run gtd next
    Then it succeeds
    And I record stdout as "next-2"
    Then stdout recorded as "status-1" is byte-identical to stdout recorded as "status-2"
    And stdout recorded as "next-1" is byte-identical to stdout recorded as "next-2"
    And the repository snapshot is unchanged

  Scenario: negative control — the snapshot helper actually detects a real write
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "develop the note", { model: "smart" })
        await human("waiting", { message: "answer the open question" })
      }

      export const fix = async () => {
        await agent("fixing", "Fix it.")
      }
      """
    And the git index has settled
    And I snapshot the repository
    When I run gtd with args "--workflow fix"
    Then it succeeds
    And the repository snapshot has changed
