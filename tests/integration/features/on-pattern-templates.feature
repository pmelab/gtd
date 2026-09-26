@inmem
Feature: flow branches read their paths from "vars"

  A flow reads the paths it branches on from `vars`, so repointing a path var
  (a top-level `.gtdrc` `vars:` key, or a `GTD_` override) reroutes the
  branch along with any prompt or `file:` reading or writing the same path,
  instead of desyncing the flow. The workflow's own `vars:` supply the
  default the override replaces.

  Scenario: a top-level "vars:" repoint reroutes a templated "on" pattern to the new path
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, vars, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        {
          default: async () => {
            await human("idle", { message: "start" })
            do {
              await agent("working", "do the work")
            } while (added(vars.outFile ?? "").length === 0)
            await human("captured", { message: "done" })
          },
        },
        { vars: { outFile: "OUT.md" } },
      )
      """
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        outFile: RENAMED.md
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And a file "RENAMED.md" with:
      """
      the renamed output
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → captured"

  Scenario: authoring at the OLD literal path no longer matches once the var is repointed
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, refuse, vars, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        {
          default: async () => {
            await human("idle", { message: "start" })
            await agent("working", "do the work")
            if (added(vars.outFile ?? "").length === 0) {
              refuse(`gtd land: no declared pattern matches — declared patterns: A ${vars.outFile}`)
            }
            await human("captured", { message: "done" })
          },
        },
        { vars: { outFile: "OUT.md" } },
      )
      """
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        outFile: RENAMED.md
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
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
      import { added, agent, human, vars, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        {
          default: async () => {
            await human("idle", { message: "start" })
            do {
              await agent("working", "do the work")
            } while (added(vars.outFile ?? "").length === 0)
            await human("captured", { message: "done" })
          },
        },
        { vars: { outFile: "OUT.md" } },
      )
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And a file "ENV_OUT.md" with:
      """
      the env-repointed output
      """
    And an environment variable "GTD_OUTFILE" set to "ENV_OUT.md"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → captured"

  Scenario: "gtd next --json" previews the branch the RENDERED path takes
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, vars, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        {
          default: async () => {
            await human("idle", { message: "start" })
            do {
              await agent("working", "do the work")
            } while (added(vars.outFile ?? "").length === 0)
            await human("captured", { message: "done" })
          },
        },
        { vars: { outFile: "OUT.md" } },
      )
      """
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        outFile: RENAMED.md
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And a file "RENAMED.md" with:
      """
      the renamed output
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "{\"status\":\"A\",\"path\":\"RENAMED.md\""
    And stdout matches "\"next\":[{][^}]*\"target\":\"captured\"[}]"
    And stdout does not contain "it.vars.outFile"
