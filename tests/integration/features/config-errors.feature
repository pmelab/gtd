@inmem
Feature: An invalid workflow config fails loudly at load time, naming where

  A `.gtdrc` keeps only `vars`, `modes` and `ui`; anything else there, a
  leftover `workflow:` key included, fails the load naming the file and the
  key. A step naming a mode no layer declares fails as soon as the process
  rests there, listing what is available. Never a silent fallback.

  Scenario: a "mode:" naming no built-in and no declared mode fails, listing what is available
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr:
          validate: "adr-lint $GTD_FILE"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start", file: ".gtd/docs/adr.md", mode: "adrs" })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "mode \"adrs\" is not a mode this workflow knows"
    And stderr contains "qa, review, adr"
    And stderr contains "step \"idle\""

  Scenario: a "modes:" entry declaring neither format nor validate still registers the name, so a step may use it
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr: {}
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start", file: ".gtd/docs/adr.md", mode: "adr" })
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
    And stderr contains "mode \"prose\" is not a mode this workflow knows (qa, review)"
    And stderr contains "step \"idle\""

  Scenario: an unknown key inside a "modes:" entry fails naming both
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr:
          validate: "adr-lint $GTD_FILE"
          lint: "also adr-lint"
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "mode \"adr\": unknown key(s) lint"

  Scenario: a malformed top-level "modes:" key fails the same way as a workflow-level one
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        qa:
          formatt: "npx prettier --write $GTD_FILE"
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "mode \"qa\": unknown key(s) formatt"

  Scenario: an unknown top-level config key fails with remediation naming the key and its file — unconditional, no --verbose needed
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "npm test"
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains ".gtdrc: testCommand: "
    And stderr contains "\"testCommand\" is unexpected"

  Scenario: the bundled testCommand under vars: fails to load, naming env:
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        testCommand: make test
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "\"vars.testCommand\" is an environment setting — move it under \"env:\""
