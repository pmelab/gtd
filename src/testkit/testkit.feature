Feature: testkit drives any workflow against the real engine

  A workflow the scenario writes itself, never a shipped one: scripted actors
  stand in for the agent, the check and the judge.

  Background:
    Given a gtd config with:
      """
      import { agent, human, judge, read, run } from "@pmelab/gtd/flows"

      export const tiny = async () => {
        await agent("plan", "Write PLAN.md.")
        await run("check", "npm test > .gtd/FEEDBACK.md 2>&1 && rm .gtd/FEEDBACK.md")
        if (read(".gtd/FEEDBACK.md") !== undefined) await agent("repair", "Make the suite pass.")
        const { answers } = await judge("ready", {
          questions: [{ id: "ready", primitive: "noul", instructions: "Ready?", criteria: "" }],
          evidence: { plan: read("PLAN.md") ?? "" },
        })
        await human(answers.ready?.answer === "yes" ? "ship" : "rework")
      }

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

  # Fails if run: proves the `workflows` project honours @skip.
  @skip
  Scenario: a scenario tagged @skip never runs
    Then the process rests at "a step this workflow does not have"
