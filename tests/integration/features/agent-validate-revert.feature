@inmem
Feature: validator form revertErrors

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, revertErrors } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await agent("work", "undo the edit", {
          validate: async () => [revertErrors([{ path: "src/x.ts", status: "modified", before: "export const x = 1\n" }], "abc1234")].filter((e) => e !== undefined),
        })
        await human("done", "finished")
      }
      """
    And a file "src/x.ts" with:
      """
      export const x = 2
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → work"
    And I run the pin beat

  Scenario: a partial revert retries with the git checkout command
    Given a file "src/y.ts" with:
      """
      export const y = 1
      """
    When I run gtd land
    And I run gtd next with "--json"
    Then stdout contains "src/x.ts still differ from abc1234~1"
    And stdout contains "git checkout abc1234~1 -- 'src/x.ts'`."
