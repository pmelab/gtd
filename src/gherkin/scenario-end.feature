@inmem
Feature: a scenario's scripted steps must be reached by its end, not by every drive

  Background:
    Given a gtd config with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export const shipping = workflow(async () => {
        await agent("plan", "Write PLAN.md.")
        await human("sign-off")
        await agent("ship", "Ship it.")
        await human("done")
      })

      export default shipping
      """
    And step "ship" writes "SHIPPED.md" with:
      """
      shipped
      """

  Scenario: an actor the Background scripts, reached only by the second drive, passes
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    When gtd starts workflow "shipping"
    And the process is driven
    Then the process rests at "sign-off"
    Given step "sign-off" writes "SIGNED.md" with:
      """
      signed
      """
    When the process is driven
    Then the process rests at "done"
    And "SHIPPED.md" contains "shipped"

  @fails
  Scenario: an actor no drive of the scenario reaches fails it at its end
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    When gtd starts workflow "shipping"
    And the process is driven
    Then the process rests at "sign-off"
