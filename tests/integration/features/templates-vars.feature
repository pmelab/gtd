@inmem
Feature: "vars" — the three-layer merged variable map every workflow sees

  Pins the merged `vars` map: a workflow's own declared `vars` defaults
  (`workflow(entries, { vars })`), overridden by a top-level `.gtdrc` `vars:`
  key, overridden by a `GTD_<NAME>` environment variable — later wins. Flow
  code reads the result through `vars`, for prompt text and for a step's
  `model` alike.

  Scenario: a workflow-declared "vars:" value renders into a prompt via `it.vars`
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, vars, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        async () => {
          await human("idle", { message: "start" })
          await agent("working", `Assigned reviewer: ${vars.reviewer}`)
        },
        { vars: { reviewer: "alice" } },
      )
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
      import { agent, human, vars, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        async () => {
          await human("idle", { message: "start" })
          await agent("working", `Assigned reviewer: ${vars.reviewer}`)
        },
        { vars: { reviewer: "alice" } },
      )
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
      import { agent, human, vars, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        async () => {
          await human("idle", { message: "start" })
          await agent("working", `Assigned reviewer: ${vars.reviewer}`)
        },
        { vars: { reviewer: "alice" } },
      )
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
    And an environment variable "GTD_REVIEWER" set to "carol"
    When I run gtd next
    Then it succeeds
    And stdout contains "Assigned reviewer: carol"
    And stdout does not contain "alice"
    And stdout does not contain "bob"

  Scenario: an environment variable matching no declared var name is ignored, not introduced
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, vars, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "start" })
        await agent("working", `Brand new: ${vars.brandNew}`)
      })
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

  Scenario: the bundled workflow's "build.health.check" script renders "npm test" from its own declared default
    Given a test project
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 failing test
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    When I run gtd next
    Then it succeeds
    And stdout contains "npm test > .gtd/.check-output"

  Scenario: a top-level "vars:" overrides the workflow's own testCommand default
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, run, vars, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        async () => {
          await human("idle", { message: "start" })
          await agent("building", "build")
          await run("checking", `${vars.testCommand} > .gtd/.check-output 2>&1`)
        },
        { vars: { testCommand: "npm test" } },
      )
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

  Scenario: a "GTD_TESTCOMMAND" environment variable overrides the bundled workflow's own testCommand
    Given a test project
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 failing test
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And an environment variable "GTD_TESTCOMMAND" set to "echo env-wins"
    When I run gtd next
    Then it succeeds
    And stdout contains "echo env-wins"
    And stdout does not contain "npm test >"

  Scenario: a machine's "model:" resolves an "it.vars" reference in "gtd next --json"
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, persona, vars, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        async () => {
          await human("idle", { message: "start" })
          await persona({ model: vars.reviewModel }, () => agent("working", "do the work"))
        },
        { vars: { reviewModel: "opus" } },
      )
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
      import { agent, vars, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        const nope = vars.nope as unknown as { deeper: string }
        await agent("working", "do the work", { model: nope.deeper })
      })
      """
    When I run gtd next
    Then it fails

  Scenario: the bundled template resolves a planner-tier state's model from "vars.plannerModel"
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

  Scenario: the bundled template resolves a coder-tier state's model from "vars.coderModel"
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      the technical plan
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.check"
    And gtd lands "gtd(check): architecture.gate.check → architecture.decompose"
    And the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-plan.md" with:
      """
      the plan
      """
    And gtd lands "gtd(agent): architecture.decompose → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-plan.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
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
