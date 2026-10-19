@inmem
Feature: a step's context limit rides on the wire

  `agent(name, prompt, { context: { soft, hard } })` and
  `scope({ context }, fn)` set the shares of the model's context window at which
  a driver asks the agent to wrap up (`soft`) and stops the turn (`hard`). A
  nested scope or the step itself replaces them key by key. `gtd next --json`
  carries them as `context` at a prompt rest; a driver fills an absent key from
  its own defaults, 0.6 and 0.7.

  Scenario: a scope's limit and the step's own merge key by key
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { scope, agent } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", context: { soft: 0.5, hard: 0.9 } }, () =>
          agent("doing", "do the work", { allowEmpty: true, context: { hard: 0.8 } }),
        )
      }
      """
    When I run gtd next with "--json=context"
    Then it succeeds
    And stdout contains "{\"soft\":0.5,\"hard\":0.8}"

  Scenario: a step that sets no limit carries none
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("doing", "do the work", { allowEmpty: true })
      }
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "\"context\""

  Scenario: a soft limit at or above the hard one is refused
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("doing", "do the work", { allowEmpty: true, context: { soft: 0.8 } })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "step \"doing\": context.soft (0.8) must be below context.hard (0.7)"

  Scenario: a share outside (0, 1] is refused
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("doing", "do the work", { allowEmpty: true, context: { hard: 70 } })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "context.hard must be a share of the context window in (0, 1], got 70"

  Scenario: a context that is not an object is refused
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("doing", "do the work", { allowEmpty: true, context: 0.6 as never })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "step \"doing\": context must be an object { soft, hard }, got 0.6"

  Scenario: a scope's malformed limit is named as the scope's
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", context: { soft: 2 } }, () =>
          agent("doing", "do the work", { allowEmpty: true }),
        )
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "step \"work.doing\": the context of scope \"work\": context.soft must be a share of the context window in (0, 1], got 2"

  Scenario: layers that only work together merge into a valid limit
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", context: { soft: 0.75, hard: 0.9 } }, () =>
          agent("doing", "do the work", { allowEmpty: true, context: { soft: 0.85 } }),
        )
      }
      """
    When I run gtd next with "--json=context"
    Then it succeeds
    And stdout contains "{\"soft\":0.85,\"hard\":0.9}"
