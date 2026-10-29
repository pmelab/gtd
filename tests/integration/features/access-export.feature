@inmem
Feature: a workflow's access option is checked when the config loads

  A workflow's `access` option — `workflow(flow, { access })` or a factory
  build's — maps a scope's full name to
  `{ read?, write? }` glob arrays, or is a function of the process settings
  returning that. A record is checked when the config loads, so a malformed
  one fails every command naming the scope and the fault; a function is
  checked once the process's settings are known.

  Background:
    Given a test project

  Scenario: a malformed entry fails the load, naming the scope
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      const access = { build: { read: ["src/**"], wirte: [] } }

      export default workflow(async () => {
        await human("idle")
      }, { access })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd: config:"
    And stderr contains "workflow \"default\"'s \"access\": scope \"build\": unknown access key \"wirte\""

  Scenario: an access option that is neither a record nor a function fails the load
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      const access = ["src/**"]

      export default workflow(async () => {
        await human("idle")
      }, { access })
      """
    When I run gtd next
    Then it fails
    And stderr contains "workflow \"default\"'s \"access\" is not a record of scope access"

  Scenario: a well-formed record and a function both load
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, workflow } from "@pmelab/gtd/flows"

      const access = { work: { read: ["docs/**"], write: [] }, other: {} }

      export default workflow(async () => {
        await scope("work", () => agent("doing", "do the work", { allowEmpty: true }))
      }, { access })
      """
    When I run gtd next with "--json=access.read"
    Then it succeeds
    And stdout contains "docs/**"
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, workflow } from "@pmelab/gtd/flows"

      const access = () => ({ work: { read: ["lib/**"] } })

      export default workflow(async () => {
        await scope("work", () => agent("doing", "do the work", { allowEmpty: true }))
      }, { access })
      """
    When I run gtd next with "--json=access.read"
    Then it succeeds
    And stdout contains "lib/**"
