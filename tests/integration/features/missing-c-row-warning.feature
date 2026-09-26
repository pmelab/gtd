@inmem
Feature: gtd rejects a flow the analyzer cannot follow, naming its source position

  A workflow is statically analysed before it is ever replayed. A construct
  the analyzer cannot turn into a finite step graph — here a flow function
  that calls itself instead of looping — fails the load with one diagnostic
  per offending site, as `gtd.config.ts:<line>:<col>: <message>`, on stderr
  only — stdout stays the machine path. The bundled workflow loads clean.

  Background:
    Given a test project

  Scenario: a flow function that calls itself fails the load with exactly one diagnostic naming its position, on stderr
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human, run, workflow } from "@pmelab/gtd/flows"

      const building = async (): Promise<void> => {
        await run("building", "exit 0")
        await building()
      }

      export default workflow({
        default: async () => {
          await human("idle", { message: "go" })
          await building()
        },
      })
      """
    When I run gtd with args "next"
    Then it fails
    And stderr contains "a flow function may not call itself" exactly 1 times
    And stderr contains "gtd.config.ts:5:9: a flow function may not call itself"
    And stdout does not contain "may not call itself"

  Scenario: the bundled unified template prints no diagnostic at all
    Given the workflow
    When I run gtd with args "next"
    Then it succeeds
    And stderr does not contain "gtd.config.ts:"
