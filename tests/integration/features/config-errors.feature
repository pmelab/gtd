@inmem
Feature: An invalid workflow config fails loudly at load time, naming where

  The `config` export of `gtd.config.ts` keeps only `modes`, `ui`, `skills`
  and `access`; anything else there fails the load naming the file and the
  key. A step naming a mode nothing declares fails as soon as the process
  rests there, listing what is available. Never a silent fallback.

  Scenario: a "mode:" naming no built-in and no declared mode fails, listing what is available
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start", file: ".gtd/docs/adr.md", mode: "adrs" })
      }

      export const config = {
        modes: {
          adr: {
            validate: "adr-lint $GTD_FILE",
          },
        },
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "mode \"adrs\" is not a mode this workflow knows"
    And stderr contains "qa, review, findings, adr"
    And stderr contains "step \"idle\""

  Scenario: a "modes:" entry declaring neither format nor validate still registers the name, so a step may use it
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start", file: ".gtd/docs/adr.md", mode: "adr" })
      }

      export const config = {
        modes: {
          adr: {},
        },
      }
      """
    When I run gtd next
    Then it succeeds
    # The name resolves: contrast the "adrs" typo above, which fails naming
    # every known mode. An empty entry declares no format: and no validate:,
    # so gtd neither rewrites nor validates the file — it only accepts it.
    And stderr does not contain "is not a mode this workflow knows"

  Scenario: a "mode: prose" naming no "modes:" declaration fails — the engine blesses no built-in vocabulary of its own
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start", file: ".gtd/NOTES.md", mode: "prose" })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "mode \"prose\" is not a mode this workflow knows (qa, review, findings)"
    And stderr contains "step \"idle\""

  Scenario: an unknown key inside a "modes:" entry fails naming both
    Given a test project
    And the workflow gtd install scaffolds
    And the file "gtd.config.ts" ends with:
      """
      export const config = {
        modes: {
          adr: { validate: "adr-lint $GTD_FILE", lint: "also adr-lint" },
        },
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "gtd.config.ts: config.modes.adr.lint: is not a known key"

  Scenario: a removed key in the config export fails with remediation naming the key and its file — unconditional, no --verbose needed
    Given a test project
    And the workflow gtd install scaffolds
    And the file "gtd.config.ts" ends with:
      """
      export const config = { env: { testCommand: "npm test" } }
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains "gtd config:"
    And stderr contains "gtd.config.ts: config.env: is not a known key"

  Scenario: defineConfig rejects a removed key while gtd.config.ts loads
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { defineConfig } from "@pmelab/gtd/flows"
      export { feature as default } from "@pmelab/gtd/workflows"

      export const config = defineConfig({ vars: { greeting: "hi" } } as never)
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains "gtd.config.ts: config.vars: is not a known key"

  Scenario: a repository with no gtd.config.ts is told to run gtd install
    Given a test project
    When I run gtd next
    Then the exit code is 1
    And stderr contains "gtd config:"
    And stderr contains "no workflows configured: no gtd.config.ts here or above — run `gtd install` to scaffold one"

  Scenario: an engine on another flows protocol is refused, naming which side to upgrade
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        ;(globalThis as Record<symbol, unknown>)[Symbol.for("@pmelab/gtd/flow-protocol")] = 2
        await human("idle", { message: "start" })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "the workflow speaks flows protocol 1, but the engine installed protocol 2"
    And stderr contains "upgrade the @pmelab/gtd the workflow imports"
