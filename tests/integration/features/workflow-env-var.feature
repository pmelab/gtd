@inmem
Feature: "--var" pins process settings only

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      const defaults = { route: "fast" }
      const envDefaults = { checker: "make check" }

      export default workflow(async () => {
        await human("idle", { message: "start" })
      }, { defaults, envDefaults })

      export const working = workflow(async () => {
        await agent("working", "do the work")
      }, { defaults, envDefaults })
      """

  Scenario: "--var" naming an environment setting is a usage error
    When I run gtd with args "start working --var checker=true"
    Then the exit code is 2
    And stderr contains "pins process settings only"
    And stderr contains "set it as a workflow option in gtd.config.ts"

  Scenario: "--var" naming an undeclared setting is a usage error too
    When I run gtd with args "start working --var nonsense=true"
    Then the exit code is 2
    And stderr contains "not declared by this workflow"

  Scenario: "--var" naming a process setting is pinned
    When I run gtd with args "start working --var route=slow"
    Then it succeeds
    And the last commit body contains "Gtd-Var: route=slow"
