@inmem
Feature: "--var" persistence across a whole process, overridden by the environment

  A `--var <name>=<value>` supplied at `gtd --entry <state>` is recorded as a
  `Gtd-Var: <name>=<value>` trailer on the process's FIRST (oldest) commit and
  re-parsed on every subsequent turn (`Edge.ts`'s `parseEntryVarTrailers`/
  `resolveVars`) — it is a fixed override for the WHOLE process, not just the
  entry turn itself. `resolveVars`'s layering is `{...workflowVars, ...rcVars,
  ...entryVars}`, then for each resulting var name, a
  `GTD_<NAME-UPPERCASED>` environment variable — if set — OVERRIDES it: the
  environment always wins, even over an explicit `--var`.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, vars, workflow } from "@pmelab/gtd/flows"

      const announce = () => agent("announcing", `Greeting: ${vars.greeting}`)

      const work = async () => {
        await agent("working", "do the work")
        await announce()
      }

      export default workflow(
        {
          default: async () => {
            await human("idle", { message: "start" })
            await work()
          },
          working: work,
          announcing: announce,
        },
        { vars: { greeting: "hi" } },
      )
      """

  Scenario: a "--var" value supplied at entry stays visible in a later turn's rendered prompt
    When I run gtd with args "--entry working --var greeting=hello"
    Then it succeeds
    And the last commit subject is "gtd(human): working"
    Given a file "work-output.txt" with:
      """
      the agent's work
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → announcing"
    When I run gtd next
    Then it succeeds
    And stdout contains "Greeting: hello"

  Scenario: a "GTD_" environment variable overrides a "--var" value supplied at entry
    When I run gtd with args "--entry announcing --var greeting=hello"
    Then it succeeds
    And the last commit subject is "gtd(human): announcing"
    Given an environment variable "GTD_GREETING" set to "fromenv"
    When I run gtd next
    Then it succeeds
    And stdout contains "Greeting: fromenv"
    And stdout does not contain "Greeting: hello"
