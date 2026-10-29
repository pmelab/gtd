@inmem
Feature: workflow() marks an exported workflow on purpose

  Every exported function is a startable workflow. `workflow(fn)` marks one
  as meant; once a config marks any, loading it warns about each other
  exported function left unmarked — most likely a helper exported by
  mistake. The warning never stops a command. A config that marks nothing,
  a workflow factory and the default export never warn.

  Background:
    Given a test project

  Scenario: an unmarked exported helper warns once the config marks a workflow
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export const helper = async () => {
        await human("helping")
      }

      export const hotfix = workflow(async () => {
        await human("fixing")
      })

      export default workflow(async () => {
        await human("idle")
      })
      """
    When I run gtd next
    Then it succeeds
    And stderr contains "gtd: warning:"
    And stderr contains "helper: is a startable workflow not marked with workflow()"
    And stderr does not contain "hotfix: is a startable workflow"

  Scenario: a config that marks nothing does not warn
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export const helper = async () => {
        await human("helping")
      }

      export default async () => {
        await human("idle")
      }
      """
    When I run gtd next
    Then it succeeds
    And stderr does not contain "not marked with workflow()"

  Scenario: a factory and the default export are never warned about
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { defineWorkflow, human, workflow } from "@pmelab/gtd/flows"

      const any = { "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) } }

      export const fix = defineWorkflow(any, () => ({
        flow: async () => {
          await human("fixing")
        },
      }))

      export const hotfix = workflow(async () => {
        await human("hotfixing")
      })

      export default async function feature() {
        await human("idle")
      }
      """
    When I run gtd next
    Then it succeeds
    And stderr does not contain "not marked with workflow()"
