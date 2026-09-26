@inmem
Feature: gtd next --json — attempt commits and the derived stall

  A no-change agent turn is VISIBLE: an agent step that lands a clean tree
  and does not declare `allowEmpty: true` commits an empty
  `gtd(<actor>): <step>` attempt, and the process stays at the step.
  `kind: "stalled"` is derived from that history — HEAD is an empty attempt at
  the resting step, the tree is clean, and another dispatch would just repeat
  it — a pure read `gtd next --json` reports on EVERY call, peeked any number
  of times, sticky until the flow lets the step finish empty (`allowEmpty`)
  and a loop counter in flow code escalates.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, run, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent(
          "working",
          "Build the package described below: write src/calc.ts exporting add(a, b).",
        )
        await run("checking", "true")
      })
      """
    And a gtd config file at ".gtdrc" with:
      """
      vars: {}
      """

  Scenario: an agent turn that changes nothing lands an empty attempt, and the next read reports stalled
    Given a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working"
    And the git status is clean
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"kind\":\"stalled\""

  Scenario: the stalled beat's content is a diagnosis naming the state and every escape
    Given a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"kind\":\"stalled\""
    And the json field "content" contains "stalled at \"working\""
    And the json field "content" contains "allowEmpty: true"
    And the json field "content" contains "escalation"

  Scenario: a stalled beat at a prompt state whose machine declares system: prints its stall diagnosis with no persona text and no System: line
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, persona, run, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await persona({ system: "You are a careful senior engineer." }, () =>
          agent("working", "Build the package described below: write src/calc.ts exporting add(a, b)."),
        )
        await run("checking", "true")
      })
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working"
    When I run gtd next
    Then it succeeds
    And stdout contains "stalled at \"working\""
    And stdout does not contain "System:"
    And stdout does not contain "You are a careful senior engineer."
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"system\":\"You are a careful senior engineer.\""

  Scenario: before the attempt lands, the same beat reports no stall
    Given a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"

  Scenario: a prompt state declaring "C" commits its C target instead — never an attempt, never stalled
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, run, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent(
          "working",
          "Build the package described below: write src/calc.ts exporting add(a, b).",
          { allowEmpty: true },
        )
        await run("checking", "true")
      })
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → checking"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"

  Scenario: retry redirects the escalating attempt once its cap is reached, clearing the stall
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, run, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        let fruitless = 0
        for (;;) {
          await agent(
            "working",
            "Build the package described below: write src/calc.ts exporting add(a, b).",
            { allowEmpty: true },
          )
          if (added("DONE.md").length > 0) break
          fruitless++
          if (fruitless >= 2) {
            await human("escalate", { message: "stuck — the agent made no progress" })
            break
          }
        }
        await run("checking", "true")
      })
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → escalate"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"

  Scenario: a dirty tree suppresses the stall report
    Given a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working"
    Given a file "scratch.md" with:
      """
      not yet committed
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"

  Scenario: a script rest's clean step is still a plain no-op — never an attempt, never stalled
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, run, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        for (;;) {
          await agent(
            "working",
            "Build the package described below: write src/calc.ts exporting add(a, b).",
          )
          do {
            await run("checking", "true")
          } while (added("FEEDBACK.md").length === 0)
        }
      })
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
    And a file "src/calc.ts" with:
      """
      export const add = (a, b) => a + b
      """
    And gtd lands "gtd(agent): working → checking"
    When I run gtd land
    Then it settles
    And stdout contains "nothing to do at \"checking\""
    And the last commit subject is "gtd(agent): working → checking"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"

  Scenario: a message rest's clean step is still a plain no-op — never an attempt, never stalled
    When I run gtd land
    Then it succeeds
    And stdout contains "nothing to do at \"idle\""
    And the last commit subject is "chore: add .gtdrc"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "stalled"
