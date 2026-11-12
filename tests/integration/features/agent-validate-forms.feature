@inmem
Feature: validator forms of the turn checks

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, progressErrors } from "@pmelab/gtd/flows"
      import { assertionErrors } from "@pmelab/gtd/workflow-kit"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("work", "address .gtd/FEEDBACK.md", {
          validate: async ({ changes }) => [progressErrors(".gtd/FEEDBACK.md", changes), assertionErrors(changes)].filter((e) => e !== undefined),
        })
        await human("done", "finished")
      }
      """
    And a file ".gtd/FEEDBACK.md" with:
      """
      do it
      """
    And a file "features/a.feature" with:
      """
      Feature: a
        Scenario: s
          When x
          Then y
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → work"
    And I run the pin beat

  Scenario: a turn that only deletes the feedback file retries naming it
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd land
    And I run gtd next with "--json"
    Then stdout contains "FEEDBACK.md was deleted without addressing"
    And stdout contains "Its content was:"
    And stdout contains "do it"

  Scenario: a turn that drops a Then step retries listing the line
    Given a file "features/a.feature" with:
      """
      Feature: a
        Scenario: s
          When x
      """
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    And I run gtd next with "--json"
    Then stdout contains "Restore the assertions these .feature files lost:"
    And stdout contains "features/a.feature: Scenario: s: Then y"

  Scenario: a valid turn completes without a retry
    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    And the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd land
    Then the last commit subject is "gtd(agent): work → done"
