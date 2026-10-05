@inmem
Feature: "--var" pins process settings only

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, refuse } from "@pmelab/gtd/flows"

      export default async ({ entry }) => {
        if (entry === "working") {
          await agent("working", "do the work")
          return
        }
        if (entry !== undefined) refuse(`"${entry}" is not an enterable state`)
        await human("idle", { message: "start" })
      }

      export const defaults = { route: "fast" }
      export const envDefaults = { checker: "make check" }
      """

  Scenario: "--var" naming an environment setting is a usage error
    When I run gtd with args "--entry working --var checker=true"
    Then the exit code is 2
    And stderr contains "pins process settings only"
    And stderr contains "env:"

  Scenario: "--var" naming an undeclared setting still refuses with exit 1
    When I run gtd with args "--entry working --var nonsense=true"
    Then the exit code is 1
    And stderr contains "not declared by this workflow"

  Scenario: "--var" naming a process setting is pinned
    When I run gtd with args "--entry working --var route=slow"
    Then it succeeds
    And the last commit body contains "Gtd-Var: route=slow"
