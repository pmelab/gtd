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

  Scenario: an actor the Background scripts may go unreached in a scenario another scenario reaches it in
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    When gtd starts workflow "shipping"
    And the process is driven
    Then the process rests at "sign-off"

  @fails
  Scenario: an actor the scenario scripts that no drive reaches fails it at its end
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And step "done" writes "DONE.md" with:
      """
      done
      """
    When gtd starts workflow "shipping"
    And the process is driven
    Then the process rests at "sign-off"

  @fails
  Scenario: a lenient drive leaves an actor no drive reaches to fail the scenario at its end
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And step "done" writes "DONE.md" with:
      """
      done
      """
    When gtd starts workflow "shipping"
    And the process is driven leniently
    Then the process rests at "sign-off"

  Scenario: a refused drive excuses the actors it was handed
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And step "sign-off" changes nothing
    And step "done" writes "DONE.md" with:
      """
      done
      """
    When gtd starts workflow "shipping"
    Then driving the process is refused with 'the actor for human step "sign-off" changed nothing'

  @fails
  Scenario: an actor scripted after a refused drive, and reached by no later one, fails the scenario
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And step "sign-off" changes nothing
    When gtd starts workflow "shipping"
    Then driving the process is refused with 'the actor for human step "sign-off" changed nothing'
    Given step "done" writes "DONE.md" with:
      """
      done
      """
