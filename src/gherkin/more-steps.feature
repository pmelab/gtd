@inmem
Feature: steps for checks, stalls, beat fields, commit bodies and the environment

  Background:
    Given a gtd config with:
      """
      import { agent, check, envSettings, human, scope, settings, workflow } from "@pmelab/gtd/flows"

      const defaults = { title: "untitled" }
      const envDefaults = { greeting: "hi" }

      export const tested = workflow(async () => {
        await scope({ name: "build", skills: ["tdd", "review"] }, async () => {
          await agent("plan", "Plan.", { model: "smart" })
        })
        const green = await check("test", "npm test", ".gtd/FEEDBACK.md")
        await agent(green ? "ship" : "repair", `Say ${envSettings.greeting} to ${settings.title}.`)
        await human("done")
      }, { defaults, envDefaults })

      export default tested
      """

  Scenario: the resting step's fields are read by name
    When gtd starts workflow "tested"
    Then the process rests at "build.plan"
    And the resting step's model is "smart"
    And the resting step's idle is "false"
    And the resting step's skills includes "review"
    And the resting step's content includes "Plan"

  Scenario: a quoted argument keeps its spaces
    Given step "build.plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And check step "test" passes
    When gtd starts workflow "tested" with "--var 'title=a calculator'"
    And the process is driven
    Then the resting step's content contains "Say hi to a calculator."

  Scenario: an agent step that changes nothing stalls
    Given step "build.plan" changes nothing
    When gtd starts workflow "tested"
    And the process is driven
    Then the process stalls at "build.plan"

  Scenario: a passing check step goes on, and a variable changed mid-process is seen from then on
    Given step "build.plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And check step "test" passes
    When gtd starts workflow "tested"
    And the process is driven
    Then the process rests at "ship"
    And the resting step's content contains "Say hi to untitled."
    Given from now on the environment variable "GTD_GREETING" is "hello"
    Then the resting step's content contains "Say hello to untitled."

  Scenario: a failing check step writes its report
    Given the environment variable "GTD_GREETING" is "hey"
    And step "build.plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And check step "test" fails with:
      """
      1 test failing
      """
    When gtd starts workflow "tested"
    And the process is driven
    Then the process rests at "repair"
    And ".gtd/FEEDBACK.md" contains "1 test failing"
    And the resting step's content contains "Say hey to untitled."

  Scenario: a check step scripted at a step that is no check refuses the drive
    Given check step "build.plan" passes
    When gtd starts workflow "tested"
    Then driving the process is refused with 'step "build.plan" is no check step; its actor is agent'

  Scenario: commit bodies are read whole, every commit of a subject at once
    Given the working tree is committed with the message:
      """
      chore: seed

      Seeded by hand.

      Refs: #1
      """
    And step "build.plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And check step "test" passes
    When gtd starts workflow "tested"
    And the process is driven
    Then the last commit body contains "Gtd-Step: test#1"
    And the commit "gtd(agent): build.plan → test" has a body containing "Gtd-Step: build.plan#1"
    And the commit "chore: seed" has a body containing "Seeded by hand."
    And no commit body contains "never written"

  Scenario: a canned command matched by pattern, a branch at a ref, and a file as committed there
    Given a file "a.txt" with:
      """
      one
      """
    And the working tree is committed as "chore: one"
    And a file "a.txt" with:
      """
      two
      """
    And the working tree is committed as "chore: two"
    And a branch "old" at "HEAD~1"
    And the command matching "^npm (test|run)" exits 1 with:
      """
      red
      """
    And step "build.plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    And step "test" runs its script
    When gtd starts workflow "tested"
    And the process is driven
    Then the process rests at "repair"
    And "a.txt" as committed at "old" contains "one"
    And ".gtd/FEEDBACK.md" contains "red"

  Scenario: text is appended to a file, and a step overwrites one only if it exists
    Given a file "NOTES.md" with:
      """
      first
      """
    And text is appended to "NOTES.md":
      """
      second
      """
    And step "build.plan" overwrites "PLAN.md", if it exists, with:
      """
      never written
      """
    And step "build.plan" overwrites "NOTES.md", if it exists, with:
      """
      rewritten
      """
    And step "test" runs its script
    And the command "npm test" exits 0
    When gtd starts workflow "tested"
    And the process is driven
    Then the process rests at "ship"
    And "NOTES.md" contains "rewritten"
    And "PLAN.md" does not exist

  Scenario: a config given as source imports a module the scenario names
    Given the module "src/gherkin/tiny.fixture.ts" is importable as "#workflow"
    And a gtd config with:
      """
      export { tiny, tiny as default } from "#workflow"
      """
    And a file "IDEA.md" with:
      """
      a calculator
      """
    And step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    When the process is driven
    Then the process rests at "sign-off"
