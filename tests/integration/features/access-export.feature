@inmem
Feature: the access export is checked when the config loads

  A workflow module's `access` export maps a scope's full name to
  `{ read?, write? }` glob arrays, or is a function of the process settings
  returning that. A record is checked when the config loads, so a malformed
  one fails every command naming the scope and the fault; a function is
  checked once the process's settings are known.

  Background:
    Given a test project

  Scenario: a malformed entry fails the load, naming the scope
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle")
      }

      export const access = { build: { read: ["src/**"], wirte: [] } }
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd: config:"
    And stderr contains "the \"access\" export: scope \"build\": unknown access key \"wirte\""

  Scenario: an access export that is neither a record nor a function fails the load
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle")
      }

      export const access = ["src/**"]
      """
    When I run gtd next
    Then it fails
    And stderr contains "the \"access\" export is not a record of scope access"

  Scenario: a well-formed record and a function both load
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope("work", () => agent("doing", "do the work", { allowEmpty: true }))
      }

      export const access = { work: { read: ["docs/**"], write: [] }, other: {} }
      """
    When I run gtd next with "--json=access.read"
    Then it succeeds
    And stdout contains "docs/**"
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope("work", () => agent("doing", "do the work", { allowEmpty: true }))
      }

      export const access = () => ({ work: { read: ["lib/**"] } })
      """
    When I run gtd next with "--json=access.read"
    Then it succeeds
    And stdout contains "lib/**"
