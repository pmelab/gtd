@inmem
Feature: An invalid workflow config fails loudly at load time, naming where

  The `config` export of `gtd.config.ts` keeps only `ui`, `skills`, `access`
  and `historyRemote`; anything else there fails the load naming the file and
  the key. Never a silent fallback.

  Scenario: a removed key in the config export fails with remediation naming the key and its file — unconditional, no --verbose needed
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
      }
      """
    And the file "gtd.config.ts" ends with:
      """
      export const config = { env: { testCommand: "npm test" } }
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains "gtd: config:"
    And stderr contains "gtd.config.ts: config.env: is not a known key"

  Scenario: defineConfig rejects a removed key while gtd.config.ts loads
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { defineConfig, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
      }

      export const config = defineConfig({ vars: { greeting: "hi" } } as never)
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains "gtd.config.ts: config.vars: is not a known key"

  Scenario: a repository with no gtd.config.ts is told gtd ships no workflow and where to look
    Given a test project
    When I run gtd next
    Then the exit code is 1
    And stderr contains "gtd: config:"
    And stderr contains "no workflows configured: no gtd.config.ts here or above — gtd ships no workflow; write your own — `gtd guide` says how"

  Scenario: an engine on another flows protocol is refused, naming which side to upgrade
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        ;(globalThis as Record<symbol, unknown>)[Symbol.for("@pmelab/gtd/flow-protocol")] = 3
        await human("idle", { message: "start" })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "the workflow speaks flows protocol 2, but the engine installed protocol 3"
    And stderr contains "upgrade the @pmelab/gtd the workflow imports"
