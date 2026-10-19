@inmem
Feature: a bad buildTail call fails naming both forms

  A gtd.config.ts calling buildTail with arguments that fit neither
  buildTail(base, options?) nor buildTail(fixFirst, base, green?, options?)
  fails naming both call forms.

  Scenario: a numeric first argument is rejected
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"
      import { buildTail, defaults } from "@pmelab/gtd/workflows"

      export { defaults }

      export default async () => {
        await human("idle", { message: "start", file: "TODO.md" })
        await buildTail(1 as never)
      }
      """
    And a file "TODO.md" with:
      """
      # Task
      """
    When I run gtd land
    Then it fails
    And stderr contains "buildTail(base, options?)"
    And stderr contains "buildTail(fixFirst, base, green?, options?)"

  Scenario: a fixFirst boolean without a base is rejected
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"
      import { buildTail, defaults } from "@pmelab/gtd/workflows"

      export { defaults }

      export default async () => {
        await human("idle", { message: "start", file: "TODO.md" })
        await buildTail(true as never)
      }
      """
    And a file "TODO.md" with:
      """
      # Task
      """
    When I run gtd land
    Then it fails
    And stderr contains "buildTail(base, options?)"
    And stderr contains "buildTail(fixFirst, base, green?, options?)"

  Scenario: a base followed by a boolean is rejected
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"
      import { buildTail, defaults } from "@pmelab/gtd/workflows"

      export { defaults }

      export default async () => {
        await human("idle", { message: "start", file: "TODO.md" })
        await buildTail("HEAD", true as never)
      }
      """
    And a file "TODO.md" with:
      """
      # Task
      """
    When I run gtd land
    Then it fails
    And stderr contains "buildTail(base, options?)"
    And stderr contains "buildTail(fixFirst, base, green?, options?)"
