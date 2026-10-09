@inmem
Feature: "vars" and "env" — the merged setting maps every workflow sees

  Pins the merged `vars` map: a workflow's own `defaults` export, overridden by a top-level `.gtdrc` `vars:`
  key, overridden by a `GTD_<NAME>` environment variable — later wins, as of
  the process's start (it is pinned then). The `env` map layers the same way
  from `envDefaults` and `.gtdrc` `env:`, but is read live on every call. Flow
  code reads the results through `vars` and `env`, for prompt text and for a
  step's `model` alike.

  Scenario: a workflow-declared "vars:" value renders into a prompt through `vars`
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, vars } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await agent("working", `Assigned reviewer: ${vars.reviewer}`)
      }

      export const defaults = { reviewer: "alice" }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next
    Then it succeeds
    And stdout contains "Assigned reviewer: alice"

  Scenario: a top-level ".gtdrc" "vars:" key overrides the workflow's own declared default
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, vars } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await agent("working", `Assigned reviewer: ${vars.reviewer}`)
      }

      export const defaults = { reviewer: "alice" }
      """
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        reviewer: bob
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next
    Then it succeeds
    And stdout contains "Assigned reviewer: bob"
    And stdout does not contain "alice"

  Scenario: a "GTD_" environment variable beats both the workflow default and the ".gtdrc" value
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, vars } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await agent("working", `Assigned reviewer: ${vars.reviewer}`)
      }

      export const defaults = { reviewer: "alice" }
      """
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        reviewer: bob
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And an environment variable "GTD_REVIEWER" set to "carol"
    And gtd lands "gtd(human): idle → working"
    When I run gtd next
    Then it succeeds
    And stdout contains "Assigned reviewer: carol"
    And stdout does not contain "alice"
    And stdout does not contain "bob"

  Scenario: an environment variable matching no declared var name is ignored, not introduced
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, vars } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await agent("working", `Brand new: ${vars.brandNew}`)
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And an environment variable "GTD_BRANDNEW" set to "hello"
    When I run gtd next
    Then it succeeds
    And stdout does not contain "hello"

  Scenario: a top-level "vars:" overrides the workflow's own testCommand default
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, run, vars } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await agent("building", "build")
        await run("checking", `${vars.testCommand} > .gtd/.check-output 2>&1`)
      }

      export const defaults = { testCommand: "npm test" }
      """
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        testCommand: echo overridden
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → building"
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): building → checking"
    When I run gtd next
    Then it succeeds
    And stdout contains "echo overridden"
    And stdout does not contain "npm test >"

  Scenario: an agent step's "model" read from "vars" shows in "gtd next --json"
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, scope, vars } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await scope({ model: vars.reviewModel }, () => agent("working", "do the work"))
      }

      export const defaults = { reviewModel: "opus" }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"model\":\"opus\""

  Scenario: a templated "model:" render failure fails "gtd next" the same way a content render failure would
    # The model expression throws (an undeclared var has no `.deeper`) the
    # moment replay reaches the step — here the default entry's first step,
    # so the very first read fails.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, vars } from "@pmelab/gtd/flows"

      export default async () => {
        const nope = vars.nope as unknown as { deeper: string }
        await agent("working", "do the work", { model: nope.deeper })
      }
      """
    When I run gtd next
    Then it fails

  Scenario: the bundled template resolves a planner-tier state's model from "env.plannerModel"
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(check): start-gate.check → design.triage"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And stdout contains "\"model\":\"smart\""

  Scenario: the bundled template resolves a coder-tier state's model from "env.coderModel"
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture.author"
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      the technical plan
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    And gtd lands "gtd(human): architecture.gate.answer → architecture.decompose.decomposing"
    And a file ".gtd/packages/01-plan.md" with:
      """
      the plan
      """
    And gtd lands "gtd(agent): architecture.decompose.decomposing → packages.item.building"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.building\""
    And stdout contains "\"model\":\"base\""

  Scenario: a "GTD_PLANNERMODEL" override repoints every planner-tier state at once
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And an environment variable "GTD_PLANNERMODEL" set to "opus"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"model\":\"opus\""
    And stdout does not contain "\"model\":\"smart\""

  Scenario: "env" layers envDefaults, then ".gtdrc" env:, then "GTD_<NAME>", live on every call
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, env, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await agent("working", `Runner: ${env.runner}`)
      }

      export const envDefaults = { runner: "alice" }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next
    Then it succeeds
    And stdout contains "Runner: alice"
    Given a file ".gtdrc" with:
      """
      env:
        runner: bob
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Runner: bob"
    Given an environment variable "GTD_RUNNER" set to "carol"
    When I run gtd next
    Then it succeeds
    And stdout contains "Runner: carol"
    And stdout does not contain "bob"
