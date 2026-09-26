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
          validate: "adr-lint <%= it.file %>"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "start", file: ".gtd/docs/adr.md", mode: "adrs" })
      })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "mode \"adrs\" is not a mode this workflow knows"
    And stderr contains "qa, review, adr"
    And stderr contains "step \"idle\""

  Scenario: a "modes:" entry declaring neither format nor validate is valid — the format-only tier
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr: {}
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "start", file: ".gtd/docs/adr.md", mode: "adr" })
      })
      """
    When I run gtd next
    Then it succeeds

  Scenario: a "mode: prose" naming no "modes:" declaration fails — the engine blesses no built-in vocabulary of its own
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "start", file: ".gtd/NOTES.md", mode: "prose" })
      })
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
          validate: "adr-lint <%= it.file %>"
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
          formatt: "npx prettier --write <%= it.file %>"
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "mode \"qa\": unknown key(s) formatt"

  Scenario: a leftover ".gtdrc" "workflow:" key fails with the migration message, not downstream noise
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "\"workflow\" is no longer read from a .gtdrc file"
    And stderr contains "define the workflow in gtd.config.ts"

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
