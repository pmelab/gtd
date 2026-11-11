@inmem
Feature: agent() validate — steps in the validator, options and misuse

  Scenario: a check in the validator rests as a script beat and its report reaches the retry
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, run } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("work", "write src/a.ts", {
          validate: async ({ changes }) => {
            await run("lint", "echo lint-report > .lint-report")
            return "lint said: " + (await Promise.resolve("fix it")) + " in " + changes.paths.join(",")
          },
        })
        await human("done", "finished")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → work"
    And I run the pin beat
    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "\"state\":\"work.validate.lint\""
    And stdout contains "\"kind\":\"script\""
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "\"kind\":\"prompt\""
    And stdout contains "lint said: fix it in src/a.ts"
    And stdout does not contain ".lint-report"

  Scenario: a custom exhausted and correction replace the defaults, and a clean result then completes the step
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, restart, ship } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("work", "write src/a.ts", {
          cap: 1,
          validate: async ({ changes }) =>
            changes.get("src/a.ts")?.after?.includes("ok") ? [] : ["needs ok", "really"],
          correction: (errors) => "PLEASE: " + errors.join(" / "),
          exhausted: async (errors) => human("custom", "stuck on " + errors.length + " errors"),
        })
        await human("done", "finished")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → work"
    And I run the pin beat
    Given a file "src/a.ts" with:
      """
      export const a = "bad"
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "PLEASE: needs ok / really"
    Given a file "src/a.ts" with:
      """
      export const a = "still bad"
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "\"state\":\"custom\""
    And stdout contains "stuck on 2 errors"
    Given a file "src/a.ts" with:
      """
      export const a = "ok"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): custom → done"

  Scenario: after the invalid gate lands, a rejected result starts a new round of retries
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, restart, ship } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("work", "write src/a.ts", {
          cap: 1,
          validate: async ({ changes }) =>
            changes.get("src/a.ts")?.after?.includes("ok") ? undefined : "needs ok",
        })
        await human("done", "finished")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → work"
    And I run the pin beat
    Given a file "src/a.ts" with:
      """
      export const a = "bad"
      """
    When I run gtd land
    Given a file "src/a.ts" with:
      """
      export const a = "bad2"
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "\"state\":\"work.invalid\""
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "\"kind\":\"prompt\""
    And stdout contains "needs ok"

  Scenario: a retry's edit to a file the validator's run wrote reaches the next validation
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, run } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("work", "write src/a.ts", {
          validate: async ({ changes }) => {
            await run("fmt", "fmt src")
            return changes.get("src/b.ts")?.after?.includes("agent")
              ? undefined
              : "b missing in " + changes.paths.join(",")
          },
        })
        await human("done", "finished")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → work"
    And I run the pin beat
    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "\"state\":\"work.validate.fmt\""
    Given a file "src/b.ts" with:
      """
      export const b = "fmt"
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "b missing in src/a.ts"
    Given a file "src/b.ts" with:
      """
      export const b = "agent"
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "\"state\":\"work.validate.fmt\""
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "\"state\":\"done\""

  Scenario Outline: misuse fails the process naming the step
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, restart, ship } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("work", "write src/a.ts", <options>)
        await human("done", "finished")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it fails
    And stderr contains "<message>"

    Examples:
      | options                                                      | message                       |
      | { keep: true, validate: async () => undefined }              | step \"work\": validate cannot be combined with keep |
      | { validate: async () => undefined, cap: 0 }                  | step \"work\": cap must be a positive integer |
      | { validate: 3 }                                              | step \"work\": validate must be a function |

  Scenario Outline: a <kind> step inside the validator fails the process naming the step
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, restart, ship } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("work", "write src/a.ts", {
          validate: async () => {
            await <call>
            return undefined
          },
        })
        await human("done", "finished")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → work"
    And I run the pin beat
    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it fails
    And stderr contains "<kind>() cannot run inside the validator of \"work\""

    Examples:
      | kind    | call                          |
      | agent   | agent("sneaky", "no")         |
      | human   | human("sneaky", "no")         |
      | ship    | ship("sneaky", "feat: no")    |
      | restart | restart()                     |
