@inmem
Feature: a workflow factory validates its options when the config loads

  `defineWorkflow(schema, build)` makes a factory: calling it with options is
  a workflow with those settings. gtd validates the options when it loads the
  config, and a rejected one fails every command, naming the workflow, the
  key path and what was expected.

  Background:
    Given a test project

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

      const greeting = defineWorkflow(schema, (options) => ({
        flow: async () => {
          await human("idle", { message: "hello" })
        },
        defaults: { greeting: options.greeting ?? "hi" },
      }))

      export const greeter = greeting({ greeting: "hey" })
      export default greeter
      """
    When I run gtd with args "start greeter"
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

      const silent = defineWorkflow(schema, () => ({
        flow: async () => {
          await human("idle", { message: "hello" })
        },
      }))

      export default silent({ nope: "x" })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd.config.ts: nope: workflow \"default\" option \"nope\": is unexpected"
