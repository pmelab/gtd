@inmem
Feature: a bad buildTail or tail call fails naming both forms

  A gtd.config.ts calling buildTail or tail with arguments that fit neither of
  its call forms — buildTail(base, options?) or buildTail(fixFirst, base,
  green?, options?); tail(finish, options?) or the positional tail(fixFirst,
  finish, …) — fails naming both.

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

  Scenario: a tail call that fits neither form is rejected
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"
      import { defaults, tail } from "@pmelab/gtd/workflows"

      export { defaults }

      export default async () => {
        await human("idle", { message: "start", file: "TODO.md" })
        await tail(true as never)
      }
      """
    And a file "TODO.md" with:
      """
      # Task
      """
    When I run gtd land
    Then it fails
    And stderr contains "tail(finish, options?)"
    And stderr contains "tail(fixFirst, finish, green?, guard?, lenses?, guardRests?, lensBase?, rules?)"
