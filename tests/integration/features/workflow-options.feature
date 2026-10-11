@inmem
Feature: a shipped workflow is configured by calling its factory, which validates its options

  `feature`, `review` and `fix` from `@pmelab/gtd/workflows` are factories:
  `feature({ testCommand: "npm run ci" })` is the feature workflow with that
  setting. Exported uncalled, a factory is a workflow too, configured by the
  `.gtdrc` `vars:`/`env:` entries alone. Either way gtd validates the options
  when it loads the config, and a rejected one fails every command, naming the
  workflow, the key path and what was expected.

  Background:
    Given a test project

  Scenario: an option given in gtd.config.ts is the process setting a start records
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { feature, fix } from "@pmelab/gtd/workflows"

      export default feature()
      export const repair = fix({ judgeBudgetBytes: "65536" })
      """
    When I run gtd with args "--workflow repair"
    Then it succeeds
    And the last commit body contains "Gtd-Var: judgeBudgetBytes=65536"

  Scenario: a misspelled option fails the load, naming the workflow, the key and the options there are
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { feature } from "@pmelab/gtd/workflows"

      export default feature({ testComand: "npm run ci" })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd.config.ts: testComand: workflow \"default\" option \"testComand\": is unexpected, expected:"
    And stderr contains "\"testCommand\""

  Scenario: an option of the wrong type fails the load, saying what was expected
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { review } from "@pmelab/gtd/workflows"

      export default review({ judgeBudgetBytes: 65536 })
      """
    When I run gtd next
    Then it fails
    And stderr contains "judgeBudgetBytes: workflow \"default\" option \"judgeBudgetBytes\": Expected string, actual 65536"

  Scenario: a .gtdrc entry reaches the factory, which rejects an unknown one at the file that set it
    Given a gtd config file at "gtd.config.ts" with:
      """
      export { feature as default, feature, fix } from "@pmelab/gtd/workflows"
      """
    And a gtd config file at ".gtdrc" with:
      """
      env:
        testComand: npm run ci
      """
    When I run gtd next
    Then it fails
    And stderr contains ".gtdrc: env.testComand: workflows \"feature\", \"fix\" option \"testComand\": is unexpected"

  Scenario: a factory of your own declares its settings, which a start records
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { defineWorkflow, human } from "@pmelab/gtd/flows"

      const schema = {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (value) => {
            const issues = Object.keys(value)
              .filter((key) => key !== "greeting")
              .map((key) => ({ message: "is unexpected", path: [key] }))
            return issues.length > 0 ? { issues } : { value }
          },
        },
      }

      export const greeter = defineWorkflow(schema, (options) => ({
        flow: async () => {
          await human("idle", { message: "hello" })
        },
        defaults: { greeting: options.greeting ?? "hi" },
      }))

      export default greeter
      """
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        greeting: hey
      """
    When I run gtd with args "--workflow greeter"
    Then it succeeds
    And the last commit body contains "Gtd-Var: greeting=hey"

  Scenario: a factory of your own rejects an option it does not declare
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { defineWorkflow, human } from "@pmelab/gtd/flows"

      const schema = {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (value) => {
            const issues = Object.keys(value).map((key) => ({ message: "is unexpected", path: [key] }))
            return issues.length > 0 ? { issues } : { value }
          },
        },
      }

      export default defineWorkflow(schema, () => ({
        flow: async () => {
          await human("idle", { message: "hello" })
        },
      }))
      """
    And a gtd config file at ".gtdrc" with:
      """
      env:
        nope: x
      """
    When I run gtd next
    Then it fails
    And stderr contains "env.nope: workflow \"default\" option \"nope\": is unexpected"
