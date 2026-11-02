@inmem
Feature: Declared list and section formats as a step's mode

  A workflow declares a steering-file format with `listFormat` or
  `sectionFormat` from `@pmelab/gtd/steering` and passes it as a step's
  `mode`. After the turn, the validation script checks the file against it and
  hands every problem back as `file:line: message`, the way a built-in mode
  does. The format's spec travels in the script's `gtd check --spec`, so no
  workflow is loaded to check it.

  Scenario: gtd validate fails with the declared format's problems
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"
      import { listFormat } from "@pmelab/gtd/steering"

      const criteria = listFormat({
        name: "criteria",
        section: { title: "Acceptance criteria", level: 2 },
        item: { id: /^AC-\d+$/, separator: ":", example: "AC-1" },
        ids: { unique: true },
      })

      export default async () => {
        await human("idle", { message: "start" })
        await agent("plan", criteria.instructions, { file: ".gtd/PLAN.md", mode: criteria })
      }
      """
    And a file ".gtd/PLAN.md" with:
      """
      # Plan

      ## Acceptance criteria

      - AC-1: first
      - AC-1: again
      * AC-2: wrong marker
      """
    And gtd lands "gtd(human): idle → plan"
    And I run the pin beat
    When I run gtd with args "validate"
    Then it fails
    And stderr contains ".gtd/PLAN.md is not valid under mode \"criteria\""
    And stderr contains ".gtd/PLAN.md:6: duplicate ID AC-1 — first on line 5"
    And stderr contains ".gtd/PLAN.md:7: `*` is not an allowed marker — use `-`"
    And stderr contains "does not pass its own validation script"

  Scenario: gtd validate passes a file that follows the declared format
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"
      import { sectionFormat } from "@pmelab/gtd/steering"

      const findings = sectionFormat({ name: "notes", level: 2, title: "unique" })

      export default async () => {
        await human("idle", { message: "start" })
        await agent("note", "Take notes.", { file: ".gtd/NOTES.md", mode: findings })
      }
      """
    And a file ".gtd/NOTES.md" with:
      """
      ## One

      First.

      ## Two

      Second.
      """
    And gtd lands "gtd(human): idle → note"
    And I run the pin beat
    When I run gtd with args "validate"
    Then it succeeds

  Scenario: plain gtd next names the declared format's check for the agent to run
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"
      import { listFormat } from "@pmelab/gtd/steering"

      const signals = listFormat({ name: "signals", markers: ["1."] })

      export default async () => {
        await human("idle", { message: "start" })
        await agent("plan", "List the signals.", { file: ".gtd/SIGNALS.md", mode: signals })
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → plan"
    And I run the pin beat
    When I run gtd next
    Then it succeeds
    And stdout contains "run `gtd check signals '.gtd/SIGNALS.md' --spec '{\"kind\":\"list\",\"name\":\"signals\",\"markers\":[\"1.\"]}'`"

  Scenario: a declared format may not take the name of a mode the workflow knows
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"
      import { listFormat } from "@pmelab/gtd/steering"

      const qa = listFormat({ name: "qa" })

      export default async () => {
        await human("idle", { message: "start" })
        await agent("plan", "List.", { file: ".gtd/LIST.md", mode: qa })
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → plan"
    And I run the pin beat
    When I run gtd next
    Then it fails
    And stderr contains "declared format \"qa\" has the name of a mode this workflow already knows"
