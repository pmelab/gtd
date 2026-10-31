@inmem
Feature: History format — replay reads only the history formats it knows

  Every commit gtd writes carries a `Gtd-Format: <n>` trailer naming the
  history format it was written in. A commit without one predates the trailer
  and is format 1. This gtd writes format 4 and still reads formats 1 to 3, so a
  process an older gtd started goes on — its next beat is the pin. Format 4
  names the pin beats `gtd:pin` and `gtd:unpin`; formats 2 and 3 named them
  `pin` and `unpin`, and a pinned process an older gtd wrote still closes. A history
  in a format this gtd does not read is refused up front with exit 1 and a
  message naming both formats — never reported as the workflow having changed
  under the process.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      }
      """

  Scenario: a landing writes the current format
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"
    And the last commit body contains "Gtd-Format: 4"

  Scenario: a history written before the trailer existed replays as format 1
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And the working tree is committed with message:
      """
      gtd(human): idle → building

      Gtd-Step: idle#1
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"pin\":\"add\""
    When I run the pin beat
    And I run gtd next
    Then it succeeds
    And stdout contains "build it"

  Scenario: a history an older gtd wrote in format 1 goes on, its next beat the pin
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And the working tree is committed with message:
      """
      gtd(human): idle → building

      Gtd-Step: idle#1
      Gtd-Format: 1
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"pin\":\"add\""
    When I run the pin beat
    Then the last commit subject is "gtd(check): gtd:pin → building"
    And the last commit body contains "Gtd-Format: 4"
    When I run gtd next
    Then it succeeds
    And stdout contains "build it"

  Scenario: a pinned process an older gtd wrote in format 3 closes on its unpin beat
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And the working tree is committed with message:
      """
      gtd(human): idle → building

      Gtd-Step: idle#1
      Gtd-Format: 3
      """
    And a file ".gtd/process.gtdpin" with:
      """
      gtdpin 1 gtd in-memory
      """
    And the working tree is committed with message:
      """
      gtd(check): pin → building

      Gtd-Pin: add
      Gtd-Format: 3
      """
    And a file "a.ts" with:
      """
      export const a = 1
      """
    And the working tree is committed with message:
      """
      gtd(agent): building → unpin

      Gtd-Step: building#1
      Gtd-Format: 3
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"pin\":\"remove\""
    When I run the unpin beat
    Then the last commit subject is "gtd(check): gtd:unpin → idle"
    When I run gtd next with "--json=idle"
    Then stdout is:
      """
      true
      """

  # The commit below would also diverge: only the format gate explains the refusal.
  Scenario: a history in an unsupported format is refused, never reported as divergence
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And the working tree is committed with message:
      """
      gtd(agent): elsewhere → review

      Gtd-Step: elsewhere#1
      Gtd-Format: 5
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains "is written in history format 5, but this gtd reads formats 1 to 4"
    And stderr does not contain "the workflow changed under this process"
