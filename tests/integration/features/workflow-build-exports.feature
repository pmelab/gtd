@inmem
Feature: a workflow factory's build carries skills, access, steering and summary

  A factory's build may return `skills`, `access`, `steering` and `summary`
  beside its flow, so `export default feature()` needs no re-exported file
  exports. They are checked like the file's own exports, and the file's
  exports win: per scope for `skills` and `access`, per path for `steering`,
  whole for `summary`.

  Background:
    Given a test project

  Scenario: build-carried skills and access ride on the wire
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, defineWorkflow, scope } from "@pmelab/gtd/flows"

      const any = { "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) } }

      const feature = defineWorkflow(any, () => ({
        flow: async () => {
          await scope("work", () => agent("doing", "do the work", { allowEmpty: true }))
        },
        skills: { work: ["from-build"] },
        access: { work: { write: ["out/**"] } },
      }))

      export default feature()
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"from-build\""
    When I run gtd next with "--json=access.write"
    Then it succeeds
    And stdout contains "out/**"

  Scenario: the file's skills export wins over the build's for the same scope
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, defineWorkflow, scope } from "@pmelab/gtd/flows"

      const any = { "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) } }

      const feature = defineWorkflow(any, () => ({
        flow: async () => {
          await scope("work", () => agent("doing", "do the work", { allowEmpty: true }))
        },
        skills: { work: ["from-build"] },
      }))

      export default feature()
      export const skills = { work: ["from-file"] }
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"from-file\""
    And stdout does not contain "from-build"

  Scenario: a build-carried summary is what gtd summary prints
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, defineWorkflow, human } from "@pmelab/gtd/flows"

      const any = { "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) } }

      const feature = defineWorkflow(any, () => ({
        flow: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("building", "build it")
        },
        summary: (it) => `Built summary for ${it.entryCommit}.`,
      }))

      export default feature()
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → idle"
    When I run gtd with args "summary"
    Then it succeeds
    And stdout contains "Built summary for"

  Scenario: a build-carried access record is checked when the config loads
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { defineWorkflow, human } from "@pmelab/gtd/flows"

      const any = { "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) } }

      const feature = defineWorkflow(any, () => ({
        flow: async () => {
          await human("idle")
        },
        access: { work: { write: "out/**" } },
      }))

      export default feature()
      """
    When I run gtd next
    Then it fails
    And stderr contains "workflow \"default\"'s \"access\": scope \"work\": access.write must be an array of glob strings"

  Scenario: a build-carried steering map must map paths to mode names
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { defineWorkflow, human } from "@pmelab/gtd/flows"

      const any = { "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) } }

      const feature = defineWorkflow(any, () => ({
        flow: async () => {
          await human("idle")
        },
        steering: { ".gtd/PLAN.md": 1 },
      }))

      export default feature()
      """
    When I run gtd next
    Then it fails
    And stderr contains "workflow \"default\"'s \"steering\" is not a record of strings"
