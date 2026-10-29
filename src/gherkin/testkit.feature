@inmem
Feature: testkit drives any workflow against the real engine

  A workflow the scenario writes itself, never a shipped one: scripted actors
  stand in for the agent, the check and the judge.

  Background:
    Given a gtd config with:
      """
      import { agent, human, judge, read, refuse, run, workflow } from "@pmelab/gtd/flows"

      export const tiny = workflow(async () => {
        await agent("plan", "Write PLAN.md.")
        await run("check", "npm test > .gtd/FEEDBACK.md 2>&1 && rm .gtd/FEEDBACK.md")
        if (read(".gtd/FEEDBACK.md") !== undefined) await agent("repair", "Make the suite pass.")
        const { answers } = await judge("ready", {
          questions: [{ id: "ready", primitive: "noul", instructions: "Ready?", criteria: "" }],
          evidence: { plan: read("PLAN.md") ?? "" },
        })
        await human(answers.ready?.answer === "yes" ? "ship" : "rework")
      })

      export const picky = workflow(async () => {
        refuse("gtd: picky refuses every start")
      })

      export default tiny
      """

  Scenario: a green check goes straight to the judge, whose verdict picks the gate
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And step "check" changes nothing
    And judge step "ready" answers:
      """
      [{ "id": "ready", "answer": true, "p": 0.9 }]
      """
    When gtd starts workflow "tiny"
    And the process is driven
    Then the process rests at "ship"
    And the commit subjects end with:
      """
      gtd(human): plan
      gtd(agent): plan → check
      gtd(check): check → ready
      gtd(judge): ready → ship
      """
    And "PLAN.md" contains "add two numbers"
    And the output of gtd "next" contains "ship"
    And the output of gtd "next" does not contain "rework"

  Scenario: a red check sends the process to repair, and an unscripted step is where it rests
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And step "check" writes ".gtd/FEEDBACK.md" with:
      """
      1 test failing
      """
    When gtd starts workflow "tiny"
    And the process is driven
    Then the process rests at "repair"
    And the resting step's content contains "Make the suite pass."
    And the last commit subject is "gtd(check): check → repair"

  Scenario: a step's beat content is asserted as a queued actor
    Given step "plan" is prompted with "Write PLAN.md."
    And step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And step "check" changes nothing
    And judge step "ready" answers:
      """
      [{ "id": "ready", "answer": true, "p": 0.9 }]
      """
    When gtd starts workflow "tiny"
    And the process is driven
    Then the process rests at "ship"
    And "PLAN.md" contains "add two numbers"

  Scenario: a judge step with queued actions refuses the drive
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And step "check" changes nothing
    And step "ready" changes nothing
    And judge step "ready" answers:
      """
      [{ "id": "ready", "answer": true, "p": 0.9 }]
      """
    When gtd starts workflow "tiny"
    Then driving the process is refused with "queued actions"

  Scenario: a beat that lacks the expected text refuses the drive
    Given step "plan" is prompted with "Write a poem"
    When gtd starts workflow "tiny"
    Then driving the process is refused with 'was not prompted with "Write a poem"'

  Scenario: a step only asserted to be prompted is where the drive rests, and nothing lands there
    Given step "plan" is prompted with "Write PLAN.md."
    When gtd starts workflow "tiny"
    And the process is driven
    Then the process rests at "plan"
    And the last commit subject is "gtd(human): plan"

  Scenario: a prompt asserted beside a script is checked at every visit, before the step acts
    Given step "check" is prompted with "npm test"
    And step "check" writes ".gtd/FEEDBACK.md" with:
      """
      1 test failing
      """
    And step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    When gtd starts workflow "tiny"
    And the process is driven
    Then the process rests at "repair"

  @fails
  Scenario: a prompt asserted at a step no drive reaches fails the scenario at its end
    Given step "plan" changes nothing
    And step "repair" is prompted with "Make the suite pass."
    When gtd starts workflow "tiny"
    And the process is driven
    Then the process stalls at "plan"

  Scenario: a human step scripted to change nothing refuses the drive instead of repeating it
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And step "check" changes nothing
    And judge step "ready" answers:
      """
      [{ "id": "ready", "answer": true, "p": 0.9 }]
      """
    And step "ship" changes nothing
    When gtd starts workflow "tiny"
    Then driving the process is refused with 'the actor for human step "ship" changed nothing'

  Scenario: a lenient drive rests at an unscripted check step
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    When gtd starts workflow "tiny"
    And the process is driven leniently
    Then the process rests at "check"
    And the resting step's content contains "npm test"

  Scenario: a step scripted for a later drive counts once any drive reached it
    Given step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And step "check" writes ".gtd/FEEDBACK.md" with:
      """
      1 test failing
      """
    When gtd starts workflow "tiny"
    And the process is driven
    Then the process rests at "repair"
    Given step "repair" deletes ".gtd/FEEDBACK.md"
    And judge step "ready" answers:
      """
      [{ "id": "ready", "answer": false, "p": 0.9 }]
      """
    When the process is driven
    Then the process rests at "rework"

  Scenario: a start the workflow refuses is reported with its message
    Then starting workflow "picky" with "--var mode=bad" is refused with "picky refuses every start"

  # Fails if run: proves the `workflows` project honours @skip.
  @skip
  Scenario: a scenario tagged @skip never runs
    Then the process rests at "a step this workflow does not have"
