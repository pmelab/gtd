@inmem
Feature: GTD_FLAG_* variables belong to feature flags, not to settings

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await agent("working", "do the work")
      }

      export const working = async () => {
        await agent("working", "do the work")
      }

      export const defaults = { flag_beta: "off" }
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
