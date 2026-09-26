@inmem
Feature: Initial-state entry — every unrecognized HEAD lands at the initial state

  Against the bundled default workflow, a HEAD that records no process — an
  ordinary commit, an old v1/v2-style `gtd: <label>` subject, or an actor the
  workflow doesn't declare — resolves to the default entry's first step
  (`idle`) rather than erroring.

  The one exception is an in-flight process whose recorded step the workflow
  no longer reaches — it got renamed or removed out from under the process by
  a workflow change — which refuses loudly (pointing at `gtd abandon`) rather
  than silently looking like a fresh, idle repo.

  Scenario: an ordinary non-gtd HEAD resolves to the initial state
    Given a test project
    And the workflow
    When I run gtd next
    Then it succeeds
    And stdout contains "State: idle"

  Scenario: an old v1/v2-style "gtd: <label>" subject resolves to the initial state
    Given a test project
    And the workflow
    And a commit "gtd: build" that adds "NOTE.md" with:
      """
      old two-namespace boundary commit
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "State: idle"

  Scenario: a subject naming a state the workflow doesn't declare AT ALL refuses, pointing at `gtd abandon`
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("frobnicate", { message: "write NOTE.md to start" })
          await agent("planning", "plan it")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a plan
      """
    And gtd lands "gtd(human): frobnicate → planning"
    # The workflow renames the step out from under the in-flight process.
    And "gtd.config.ts" is modified to:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await agent("planning", "plan it")
        },
      })
      """
    When I run gtd next
    Then it fails
    And stderr contains "frobnicate"
    And stderr contains "gtd abandon"

  Scenario: a subject naming an actor the workflow doesn't declare resolves to the initial state
    Given a test project
    And the workflow
    And a commit "gtd(nobody): design.triage" that adds "NOTE.md" with:
      """
      a plan
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "State: idle"
