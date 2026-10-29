@inmem
Feature: doors — named shortcuts that start a workflow with positional args

  A workflow builds its own doors — here the `fix` factory builds `fix`,
  `review` builds `review [base]`, and a plain flow takes them as a
  `workflow(flow, { doors })` option — so a config's doors are those of the
  workflows it exports. `gtd start <door> [args…]` starts the door's workflow,
  mapping the positional args to process settings; a bare `gtd start` lists
  every door beside the workflows. A door named like a workflow wins.

  Background:
    Given a test project
    And a file "flows.ts" with:
      """
      import { agent, defineWorkflow, start } from "@pmelab/gtd/flows"

      const schema = {
        "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) },
      }

      export const fix = defineWorkflow(schema, () => ({
        flow: async () => {
          await agent("mending", "Mend it.")
        },
        defaults: { ticket: "" },
        doors: { fix: {} },
      }))

      export const review = defineWorkflow(schema, () => ({
        flow: async () => {
          await agent("reviewing", `Review everything since ${start()}.`)
        },
        defaults: { reviewBase: "" },
        doors: {
          review: {
            args: [{ name: "base", optional: true }],
            vars: ({ base }) => (base === undefined ? {} : { reviewBase: base }),
          },
        },
        base: (_workflow, vars) => vars.reviewBase || "",
      }))
      """
    And the working tree is committed
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("building", "Build it.")
      }

      export { fix, review } from "./flows.js"
      """

  Scenario: a config lists the doors its workflows build, each workflow a door shadows only as the door
    When I run gtd with args "start --json"
    Then it succeeds
    And stdout contains "[{\"kind\":\"door\",\"name\":\"fix\",\"workflow\":\"fix\",\"args\":[]},{\"kind\":\"door\",\"name\":\"review\",\"workflow\":\"review\",\"args\":[{\"name\":\"base\",\"optional\":true}]}]"

  Scenario: a config exporting only fix offers only fix's door
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export { fix } from "./flows.js"
      """
    When I run gtd with args "start --json"
    Then it succeeds
    And stdout contains "[{\"kind\":\"door\",\"name\":\"fix\",\"workflow\":\"fix\",\"args\":[]}]"

  Scenario: plain gtd start prints one sorted line per door with its synopsis
    When I run gtd with args "start"
    Then it succeeds
    And stdout contains "door fix → fix"
    And stdout contains "door review [base] → review"
    And stdout does not contain "workflow fix"

  Scenario: gtd start --json=<path> reads one value off the array
    When I run gtd with args "start --json=1.args.0.name"
    Then it succeeds
    And stdout contains "base"

  Scenario: a plain flow brings the doors its workflow() options declare
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const hotfix = workflow(
        async () => {
          await agent("patch", "Patch it.")
        },
        {
          defaults: { ticket: "" },
          doors: {
            patch: { args: [{ name: "ticket" }], vars: ({ ticket }) => ({ ticket }) },
          },
        },
      )
      """
    When I run gtd with args "start --json"
    Then it succeeds
    And stdout contains "{\"kind\":\"door\",\"name\":\"patch\",\"workflow\":\"hotfix\",\"args\":[{\"name\":\"ticket\",\"optional\":false}]}"

  Scenario: gtd start <door> starts the door's workflow with its args mapped to process settings
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const hotfix = workflow(
        async () => {
          await agent("patch", "Patch it.")
        },
        {
          defaults: { ticket: "" },
          doors: {
            patch: { args: [{ name: "ticket" }], vars: ({ ticket }) => ({ ticket }) },
          },
        },
      )
      """
    When I run gtd with args "start patch T-42"
    Then it succeeds
    And the last commit subject is "gtd(human): patch"
    And the last commit body contains "Gtd-Workflow: hotfix"
    And the last commit body contains "Gtd-Var: ticket=T-42"

  Scenario: a plain flow's doors sit beside the doors the factories build
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export { fix, review } from "./flows.js"

      export const hotfix = workflow(
        async () => {
          await agent("patch", "Patch it.")
        },
        { doors: { patch: {} } },
      )
      """
    When I run gtd with args "start"
    Then it succeeds
    And stdout contains "door fix → fix"
    And stdout contains "door patch → hotfix"
    And stdout contains "door review [base] → review"
    And stdout does not contain "workflow fix"

  Scenario: gtd start fix starts the fix workflow through its door
    When I run gtd with args "start fix"
    Then it succeeds
    And the last commit body contains "Gtd-Workflow: fix"

  Scenario: gtd start review with no base reviews since the default branch's merge-base
    Given I mark the current commit as "main"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "start review"
    Then it succeeds
    And stdout contains the hash of "main"
    And the last commit body contains "Gtd-Workflow: review"

  Scenario: gtd start review <base> pins the merge-base of a diverged branch, as --var reviewBase=<base> would
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
    When I run gtd with args "start review branch-a"
    Then it succeeds
    And stdout contains the hash of "shared"
    And stdout does not contain the hash of "branch-a"
    And the last commit body contains "Gtd-Var: reviewBase=branch-a"

  Scenario: an unknown door is a usage error pointing at the list
    When I run gtd with args "start release"
    Then the exit code is 2
    And stderr contains "no workflow or door is named \"release\" — run `gtd start` to list them"

  Scenario: too many args is a usage error naming the door's synopsis
    When I run gtd with args "start review a b"
    Then the exit code is 2
    And stderr contains "too many arguments — usage: gtd start review [base]"

  Scenario: too few args is a usage error naming the door's synopsis
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const hotfix = workflow(
        async () => {
          await agent("patch", "Patch it.")
        },
        {
          defaults: { ticket: "" },
          doors: {
            patch: { args: [{ name: "ticket" }], vars: ({ ticket }) => ({ ticket }) },
          },
        },
      )
      """
    When I run gtd with args "start patch"
    Then the exit code is 2
    And stderr contains "missing arguments — usage: gtd start patch <ticket>"

  Scenario: two workflows building the same door, none exported under its name, builds no door
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export { fix as mend, fix as patch } from "./flows.js"
      """
    When I run gtd with args "start --json"
    Then it succeeds
    And stdout does not contain "\"name\":\"fix\""
    When I run gtd with args "start fix"
    Then the exit code is 2
    And stderr contains "built by workflows \"mend\" and \"patch\""
    And stderr contains "no workflow or door is named \"fix\""

  Scenario: a door several workflows build belongs to the one exported under the door's own name
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export { fix, fix as mend } from "./flows.js"
      """
    When I run gtd with args "start"
    Then it succeeds
    And stdout contains "door fix → fix"

  Scenario: a door name outside the lowercase-kebab rule is a config error
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const hotfix = workflow(
        async () => {
          await human("patch", { message: "go" })
        },
        { doors: { Go_Now: {} } },
      )
      """
    When I run gtd with args "start"
    Then the exit code is 1
    And stderr contains "door \"Go_Now\", which is not a valid door name"

  Scenario: a door named like a workflow wins, and the config warns that it hides that workflow
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const audit = workflow(async () => {
        await agent("auditing", "Audit it.")
      })

      export const hotfix = workflow(
        async () => {
          await agent("patch", "Patch it.")
        },
        { doors: { audit: {} } },
      )
      """
    When I run gtd with args "start audit"
    Then it succeeds
    And stderr contains "gtd: warning:"
    And stderr contains "door \"audit\" starts workflow \"hotfix\" and hides the workflow of the same name from `gtd start audit`"
    And the last commit body contains "Gtd-Workflow: hotfix"

  Scenario: a door refuses while a process is already underway
    Given a file "NOTE.md" with:
      """
      a sketch
      """
    And I run gtd land
    And I record the commit count
    When I run gtd with args "start fix"
    Then it fails
    And stderr contains "gtd start fix: a process is already underway"
    And the commit count is unchanged

  Scenario: a review exported under another name with no base reviews since the default branch's merge-base
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export { review as audit } from "./flows.js"
      """
    And I mark the current commit as "main"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "start review"
    Then it succeeds
    And stdout contains the hash of "main"
    And the last commit body contains "Gtd-Workflow: audit"

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
    When I run gtd with args "start"
    Then it succeeds
    And stdout contains "door go → hotfix"

  Scenario: a factory of your own brings its base, which gtd start go starts with
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
    When I run gtd with args "start go"
    Then it succeeds
    When I run gtd with args "base"
    Then it succeeds
    And stdout contains the hash of "base"

  Scenario: two instances of one factory warn on stderr and keep the other doors
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"
      import { review } from "./flows.js"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export { fix } from "./flows.js"
      export const reviewA = review({})
      export const reviewB = review({})
      """
    When I run gtd with args "start"
    Then it succeeds
    And stderr contains "gtd: warning:"
    And stderr contains "door \"review\" is built by workflows \"reviewA\" and \"reviewB\""
    And stdout contains "door fix → fix"
