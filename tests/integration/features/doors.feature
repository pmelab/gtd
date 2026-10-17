@inmem
Feature: doors — named shortcuts that start a workflow with positional args

  Each shipped workflow builds its own doors — `fix` builds `fix`, `review`
  builds `review [base]` — so a config's doors are those of the workflows it
  exports, plus its reserved `doors` export. `gtd door <name> [args…]` starts
  the door's workflow exactly as `gtd --workflow` would, mapping the positional
  args to process settings; `gtd doors` lists every door. A door's `workflow`
  names one of the config's own workflows.

  Background:
    Given a test project
    And the workflow gtd install scaffolds

  Scenario: the installed config lists the shipped fix and review doors
    When I run gtd with args "doors --json"
    Then it succeeds
    And stdout contains "[{\"name\":\"fix\",\"workflow\":\"fix\",\"args\":[]},{\"name\":\"review\",\"workflow\":\"review\",\"args\":[{\"name\":\"base\",\"optional\":true}]}]"

  Scenario: a config exporting only fix offers only fix's door
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export { fix, defaults, envDefaults } from "@pmelab/gtd/workflows"
      """
    When I run gtd with args "doors --json"
    Then it succeeds
    And stdout contains "[{\"name\":\"fix\",\"workflow\":\"fix\",\"args\":[]}]"

  Scenario: plain gtd doors prints one sorted line per door with its synopsis
    When I run gtd with args "doors"
    Then it succeeds
    And stdout contains "fix → fix"
    And stdout contains "review [base] → review"

  Scenario: gtd doors --json=<path> reads one value off the array
    When I run gtd with args "doors --json=1.args.0.name"
    Then it succeeds
    And stdout contains "base"

  Scenario: a config of plain flows has exactly its own doors export
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const hotfix = async () => {
        await agent("patch", "Patch ${vars.ticket}.")
      }

      export const defaults = { ticket: "" }

      export const doors = {
        patch: {
          workflow: "hotfix",
          args: [{ name: "ticket" }],
          vars: ({ ticket }) => ({ ticket }),
        },
      }
      """
    When I run gtd with args "doors --json"
    Then it succeeds
    And stdout contains "[{\"name\":\"patch\",\"workflow\":\"hotfix\",\"args\":[{\"name\":\"ticket\",\"optional\":false}]}]"

  Scenario: gtd door starts the door's workflow with its args mapped to process settings
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
      }

      export const defaults = { ticket: "" }

      export const doors = {
        patch: {
          workflow: "hotfix",
          args: [{ name: "ticket" }],
          vars: ({ ticket }) => ({ ticket }),
        },
      }
      """
    When I run gtd with args "door patch T-42"
    Then it succeeds
    And the last commit subject is "gtd(human): patch"
    And the last commit body contains "Gtd-Workflow: hotfix"
    And the last commit body contains "Gtd-Var: ticket=T-42"

  Scenario: a config adds its own door beside the shipped ones by spreading their doors export
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"
      import { doors as shipped } from "@pmelab/gtd/workflows"

      export { feature as default, fix, review } from "@pmelab/gtd/workflows"

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
      }

      export const doors = { ...shipped, patch: { workflow: "hotfix" } }
      """
    When I run gtd with args "doors"
    Then it succeeds
    And stdout contains "fix → fix"
    And stdout contains "patch → hotfix"
    And stdout contains "review [base] → review"

  Scenario: gtd door fix is gtd --workflow fix
    When I run gtd with args "door fix"
    Then it succeeds
    And the last commit body contains "Gtd-Workflow: fix"

  Scenario: gtd door review with no base reviews since the default branch's merge-base
    Given I mark the current commit as "main"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "door review"
    Then it succeeds
    And stdout contains the hash of "main"
    And the last commit body contains "Gtd-Workflow: review"

  Scenario: gtd door review <base> pins the merge-base of a diverged branch, as --var reviewBase=<base> would
    Given a commit "feat: shared work" that adds "shared.txt" with:
      """
      shared
      """
    And I mark the current commit as "shared"
    And a commit "feat: branch a work" that adds "a.txt" with:
      """
      a
      """
    And I mark the current commit as "branch-a"
    And I hard-reset to "shared"
    And a commit "feat: branch b work" that adds "b.txt" with:
      """
      b
      """
    When I run gtd with args "door review branch-a"
    Then it succeeds
    And stdout contains the hash of "shared"
    And stdout does not contain the hash of "branch-a"
    And the last commit body contains "Gtd-Var: reviewBase=branch-a"

  Scenario: an unknown door is a usage error listing every door
    When I run gtd with args "door release"
    Then the exit code is 2
    And stderr contains "unknown door \"release\" — doors: fix, review [base]"

  Scenario: too many args is a usage error naming the door's synopsis
    When I run gtd with args "door review a b"
    Then the exit code is 2
    And stderr contains "too many arguments — usage: gtd door review [base]"

  Scenario: too few args is a usage error naming the door's synopsis
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
      }

      export const doors = {
        patch: { workflow: "hotfix", args: [{ name: "ticket" }] },
      }
      """
    When I run gtd with args "door patch"
    Then the exit code is 2
    And stderr contains "missing arguments — usage: gtd door patch <ticket>"

  Scenario: gtd door with no name is a usage error
    When I run gtd with args "door"
    Then the exit code is 2
    And stderr contains "gtd door: missing name argument"

  Scenario: a door naming an unknown workflow is a config error
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const doors = {
        go: { workflow: "nope" },
      }
      """
    When I run gtd with args "doors"
    Then the exit code is 1
    And stderr contains "door \"go\" names workflow \"nope\""

  Scenario: two workflows building the same door, none exported under its name, builds no door
    Given a gtd config file at "gtd.config.ts" with:
      """
      export { feature as default, fix as mend, fix as patch, defaults, envDefaults } from "@pmelab/gtd/workflows"
      """
    When I run gtd with args "doors --json"
    Then it succeeds
    And stdout does not contain "\"name\":\"fix\""
    When I run gtd with args "door fix"
    Then the exit code is 2
    And stderr contains "built by workflows \"mend\" and \"patch\""
    And stderr contains "declare it in the \"doors\" export"

  Scenario: a door several workflows build belongs to the one exported under the door's own name
    Given a gtd config file at "gtd.config.ts" with:
      """
      export { feature as default, fix, fix as mend, defaults, envDefaults } from "@pmelab/gtd/workflows"
      """
    When I run gtd with args "doors"
    Then it succeeds
    And stdout contains "fix → fix"

  Scenario: a doors export declaring the clashing name settles it, the declared door winning
    Given a gtd config file at "gtd.config.ts" with:
      """
      export { feature as default, fix as mend, fix as patch, defaults, envDefaults } from "@pmelab/gtd/workflows"

      export const doors = { fix: { workflow: "mend" } }
      """
    When I run gtd with args "doors --json"
    Then it succeeds
    And stdout contains "[{\"name\":\"fix\",\"workflow\":\"mend\",\"args\":[]}]"

  Scenario: a door name outside the lowercase-kebab rule is a config error
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const doors = {
        Go_Now: { workflow: "fix" },
      }
      """
    When I run gtd with args "doors"
    Then the exit code is 1
    And stderr contains "door \"Go_Now\" is not a valid door name"

  Scenario: a door refuses while a process is already underway, like gtd --workflow
    Given a file "NOTE.md" with:
      """
      a sketch
      """
    And I run gtd land
    And I record the commit count
    When I run gtd with args "door fix"
    Then it fails
    And stderr contains "gtd door fix: a process is already underway"
    And the commit count is unchanged

  Scenario: a review exported under another name with no base reviews since the default branch's merge-base
    Given a gtd config file at "gtd.config.ts" with:
      """
      export {
        feature as default,
        review as audit,
        defaults,
        envDefaults,
        summary,
        base,
        steering,
        skills,
        access,
      } from "@pmelab/gtd/workflows"
      """
    And I mark the current commit as "main"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "door review"
    Then it succeeds
    And stdout contains the hash of "main"
    And the last commit body contains "Gtd-Workflow: audit"

  Scenario: a config importing the deprecated doors export still loads with its workflows' doors
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { doors as shipped } from "@pmelab/gtd/workflows"

      export { feature as default, fix, review } from "@pmelab/gtd/workflows"

      export const doors = { ...shipped }
      """
    When I run gtd with args "doors --json"
    Then it succeeds
    And stdout contains "[{\"name\":\"fix\",\"workflow\":\"fix\",\"args\":[]},{\"name\":\"review\",\"workflow\":\"review\",\"args\":[{\"name\":\"base\",\"optional\":true}]}]"

  Scenario: a factory of your own brings its door, listed under its export name
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { defineWorkflow, human } from "@pmelab/gtd/flows"

      const schema = {
        "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) },
      }

      const make = defineWorkflow(schema, () => ({
        flow: async () => {
          await human("idle", { message: "go" })
        },
        doors: { go: {} },
      }))

      export const hotfix = make({})
      export default async () => {
        await human("idle", { message: "go" })
      }
      """
    When I run gtd with args "doors"
    Then it succeeds
    And stdout contains "go → hotfix"

  Scenario: a factory of your own brings its base, which gtd door go starts with
    Given I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { defineWorkflow, human } from "@pmelab/gtd/flows"

      const schema = {
        "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) },
      }

      const make = defineWorkflow(schema, () => ({
        flow: async () => {
          await human("idle", { message: "go" })
        },
        doors: { go: {} },
        base: () => "base",
      }))

      export const hotfix = make({})
      export default async () => {
        await human("idle", { message: "go" })
      }
      """
    When I run gtd with args "door go"
    Then it succeeds
    When I run gtd with args "base"
    Then it succeeds
    And stdout contains the hash of "base"

  Scenario: the doors export declares the rollout door two instances clash on
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { rollout } from "@pmelab/gtd/workflows"

      export { feature as default } from "@pmelab/gtd/workflows"
      export const rolloutA = rollout({ flagRegistry: "a.ts" })
      export const rolloutB = rollout({ flagRegistry: "b.ts" })
      export const doors = {
        rollout: {
          workflow: "rolloutB",
          args: [{ name: "flag" }],
          vars: ({ flag }) => ({ flag: flag ?? "" }),
        },
      }
      """
    When I run gtd with args "doors --json"
    Then it succeeds
    And stdout contains "\"name\":\"rollout\",\"workflow\":\"rolloutB\""
    Given a commit "chore: add registry" that adds "b.ts" with:
      """
      export const flags = [{ name: "x", kind: "release", defaultOn: false }]
      """
    When I run gtd with args "door rollout x"
    Then it succeeds
    And the last commit body contains "Gtd-Workflow: rolloutB"
    And the last commit body contains "Gtd-Var: flag=x"

  Scenario: two exported rollout instances with no doors entry warn on stderr and keep the other doors
    Given a gtd config file at "gtd.config.ts" with:
      """
      export { fix } from "@pmelab/gtd/workflows"
      import { feature, rollout } from "@pmelab/gtd/workflows"

      export default feature
      export const rolloutA = rollout({ flagRegistry: "a.ts" })
      export const rolloutB = rollout({ flagRegistry: "b.ts" })
      """
    When I run gtd with args "doors"
    Then it succeeds
    And stderr contains "gtd: warning:"
    And stderr contains "door \"rollout\" is built by workflows \"rolloutA\" and \"rolloutB\""
    And stderr contains "declare it in the \"doors\" export"
    And stdout contains "fix → fix"
