@inmem
Feature: History format — replay reads only the history formats it knows

  Every commit gtd writes carries a `Gtd-Format: <n>` trailer naming the
  history format it was written in. A commit without one predates the trailer
  and is format 1. This gtd writes format 2 and still reads format 1, so a
  process an older gtd started goes on — its next beat is the pin. A history
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
    And the last commit body contains "Gtd-Format: 2"

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
    Then the last commit subject is "gtd(check): pin → building"
    And the last commit body contains "Gtd-Format: 2"
    When I run gtd next
    Then it succeeds
    And stdout contains "build it"

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
      Gtd-Format: 3
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains "is written in history format 3, but this gtd reads formats 1 to 2"
    And stderr does not contain "the workflow changed under this process"
