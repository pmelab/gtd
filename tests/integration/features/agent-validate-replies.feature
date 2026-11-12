@inmem
Feature: validator form repliesErrors

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, repliesErrors } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await agent("work", "answer the threads", {
          validate: async () => [repliesErrors(".gtd/PLAN.md")].filter((e) => e !== undefined),
        })
        await human("done", "finished")
      }
      """
    And a file ".gtd/PLAN.md" with:
      """
      Add a `greet()` export.[^why]

      [^why]:
          - H: why a function?
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → work"
    And I run the pin beat

  Scenario: an unanswered thread retries with the reply correction
    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    And I run gtd next with "--json"
    Then stdout contains "still wait on the agent"
    And stdout contains ".gtd/PLAN.md:3: [^why]"
