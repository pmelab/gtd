@inmem
Feature: signals — a wait step rests until news arrives, then the process continues

  `wait(name, { kinds })` rests the process until a signal of one of `kinds`
  arrives. `gtd signal` writes `.gtd/SIGNAL.json`; the driver lands it as the
  wait step's turn, and replay hands the signal to the flow.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, wait } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
        const signal = await wait("pr", { kinds: ["review", "merged"] })
        if (signal.kind === "review") await agent("fixing", "address the review")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I run the pin beat
    And a file "src/built.ts" with:
      """
      export const built = 1
      """
    And gtd lands "gtd(agent): building → pr"

  Scenario: a wait step rests as a message for the signal actor
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"signal\""
    And stdout contains "\"kinds\":[\"review\",\"merged\"]"

  Scenario: a signal of an accepted kind is written and then landed as the wait's turn
    When I run gtd with args "signal . review"
    Then it succeeds
    And stdout contains "written to .gtd/SIGNAL.json"
    When I run gtd next with "--json"
    Then stdout contains "\"kind\":\"capture\""
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(signal): pr → fixing"

  Scenario: a signal of a kind the wait does not accept is refused
    When I run gtd with args "signal . deploy"
    Then it fails
