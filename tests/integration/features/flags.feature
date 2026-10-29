@inmem
Feature: GTD_FLAG_* variables belong to feature flags, not to settings

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      const defaults = { flag_beta: "off" }

      export default workflow(async () => {
        await human("idle", { message: "start" })
        await agent("working", "do the work")
      }, { defaults })

      export const working = workflow(async () => {
        await agent("working", "do the work")
      }, { defaults })
      """
    And a file "NOTE.md" with:
      """
      a note
      """

  Scenario: a flag_* setting loads and ignores a GTD_FLAG_* export
    Given an environment variable "GTD_FLAG_BETA" set to "on"
    When I run gtd land
    Then it succeeds
    And the last commit body contains "Gtd-Var: flag_beta=off"
