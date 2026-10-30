@inmem
Feature: workflow() makes an exported function a workflow

  Only an export passed through `workflow(flow, options?)`, a workflow
  factory (or a call of one) and the `default` export are workflows. Any
  other exported function is a plain helper: never startable, never warned
  about. `workflow()`'s options are the keys a factory build returns
  (`defaults`, `envDefaults`, `doors`, `base`, `skills`, `access`,
  `steering`, `summary`), checked the same way. The file-level exports of
  those names are gone: exporting one fails the load, naming the
  replacement.

  Background:
    Given a test project

  Scenario: an unmarked exported function is a helper, not a workflow
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export const helper = async () => {
        await human("helping")
      }

      export const hotfix = workflow(async () => {
        await helper()
      })

      export default async () => {
        await human("idle")
      }
      """
    When I run gtd with args "start"
    Then it succeeds
    And stdout contains "hotfix"
    And stdout does not contain "helper"
    And stderr does not contain "warning"
    When I run gtd with args "start helper"
    Then the exit code is 2

  Scenario: workflow() carries the settings a factory build declares
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human, settings, workflow } from "@pmelab/gtd/flows"

      export const hotfix = workflow(
        async () => {
          await human("fixing", `ticket ${settings.ticket}`)
        },
        { defaults: { ticket: "none" } },
      )

      export default async () => {
        await human("idle")
      }
      """
    When I run gtd with args "start hotfix --var ticket=T-1"
    Then it succeeds
    And I run the pin beat
    When I run gtd next
    Then it succeeds
    And stdout contains "ticket T-1"

  Scenario: workflow() options are checked like a factory build's
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        async () => {
          await human("idle")
        },
        { steering: { ".gtd/PLAN.md": 1 }, defualts: {} },
      )
      """
    When I run gtd next
    Then it fails
    And stderr contains "workflow \"default\" has unknown option(s) \"defualts\""

  Scenario Outline: a file-level <name> export fails the load, naming its replacement
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle")
      }

      export const <name> = <value>
      """
    When I run gtd next
    Then it fails
    And stderr contains "<name>: the \"<name>\" export is no longer read — pass it to the workflow it configures: `workflow(flow, { <name> })`, or the build a workflow factory returns"

    Examples:
      | name        | value                                 |
      | defaults    | { ticket: "none" }                    |
      | envDefaults | { testCommand: "npm test" }           |
      | steering    | { ".gtd/PLAN.md": "qa" }              |
      | skills      | { build: ["tdd"] }                    |
      | access      | { build: { write: [] } }              |
      | doors       | { go: { workflow: "default" } }       |
      | summary     | () => "summary"                       |
      | base        | () => undefined                       |
