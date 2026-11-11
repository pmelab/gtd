@inmem
Feature: agent() validate — a validator's errors retry the turn

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, check, human, judge } from "@pmelab/gtd/flows"

      const errorsOf = async ({ changes }) =>
        changes.get("src/a.ts")?.after?.includes("ok") ? undefined : "src/a.ts must contain ok"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("work", "write src/a.ts", { validate: errorsOf })
        await human("done", "finished")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → work"
    And I run the pin beat

  Scenario: a turn the validator accepts completes the step
    Given a file "src/a.ts" with:
      """
      export const a = "ok"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): work → done"

  Scenario: a rejected turn rests at the retry with the same session and only the correction
    When I run gtd next with "--json"
    And I record the json field "session.id" as "s1"
    And stdout contains "\"fresh\":null"
    Given a file "src/a.ts" with:
      """
      export const a = "bad"
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"kind\":\"prompt\""
    And stdout contains "src/a.ts must contain ok"
    And stdout contains "\"resume\":true"
    And the json field "session.id" matches the one recorded as "s1"
    And stdout contains "\"fresh\":\"write "
    And stdout does not contain "\"content\":\"write "

  Scenario: after the cap the process rests at the invalid gate
    Given a file "src/a.ts" with:
      """
      export const a = "bad1"
      """
    When I run gtd land
    Given a file "src/a.ts" with:
      """
      export const a = "bad2"
      """
    When I run gtd land
    Given a file "src/a.ts" with:
      """
      export const a = "bad3"
      """
    When I run gtd land
    Given a file "src/a.ts" with:
      """
      export const a = "bad4"
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "\"state\":\"work.invalid\""
    And stdout contains "src/a.ts must contain ok"
