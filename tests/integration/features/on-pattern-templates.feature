@inmem
Feature: flow branches read their paths from "vars"

  A flow reads the paths it branches on from `vars`, so repointing a path var
  (a `GTD_` override, or a `--var` at the start) reroutes the
  branch along with any prompt or `file:` reading or writing the same path,
  instead of desyncing the flow. The workflow's own `defaults` supply the
  default the override replaces.

  Scenario: authoring at the OLD literal path no longer matches once the var is repointed
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, refuse, settings, workflow } from "@pmelab/gtd/flows"

      const defaults = { outFile: "OUT.md" }

      export default workflow(async () => {
        await human("idle", { message: "start" })
        await agent("working", "do the work")
        if (!changes(settings.outFile ?? "").some((c) => c.status === "added")) {
          refuse(`gtd land: no declared pattern matches — declared patterns: A ${settings.outFile}`)
        }
        await human("captured", { message: "done" })
      }, { defaults })
      """
    And an environment variable "GTD_OUTFILE" set to "RENAMED.md"
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And I run the pin beat
    And a file "OUT.md" with:
      """
      written at the stale default path
      """
    When I run gtd land
    Then it fails
    And stderr contains "RENAMED.md"

  Scenario: a "GTD_" override reroutes a templated "on" pattern the same way
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, settings, workflow } from "@pmelab/gtd/flows"

      const defaults = { outFile: "OUT.md" }

      export default workflow(async () => {
        await human("idle", { message: "start" })
        do {
          await agent("working", "do the work")
        } while (!changes(settings.outFile ?? "").some((c) => c.status === "added"))
        await human("captured", { message: "done" })
      }, { defaults })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And an environment variable "GTD_OUTFILE" set to "ENV_OUT.md"
    And gtd lands "gtd(human): idle → working"
    And I run the pin beat
    And a file "ENV_OUT.md" with:
      """
      the env-repointed output
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → captured"

  Scenario: "gtd next --json" previews the branch the RENDERED path takes
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, settings, workflow } from "@pmelab/gtd/flows"

      const defaults = { outFile: "OUT.md" }

      export default workflow(async () => {
        await human("idle", { message: "start" })
        do {
          await agent("working", "do the work")
        } while (!changes(settings.outFile ?? "").some((c) => c.status === "added"))
        await human("captured", { message: "done" })
      }, { defaults })
      """
    And an environment variable "GTD_OUTFILE" set to "RENAMED.md"
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And I run the pin beat
    And a file "RENAMED.md" with:
      """
      the renamed output
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "{\"status\":\"A\",\"path\":\"RENAMED.md\""
    And stdout matches "\"next\":[{][^}]*\"target\":\"captured\"[}]"
    And stdout does not contain "it.vars.outFile"
