@inmem
Feature: v3 pattern-machine smoke — one-flow hops, gtd next --json, an ordinary sign-off commit

  Minimal smoke coverage for the v3 CLI (`gtd land` / `gtd next`, see
  src/edge/Edge.ts). Proves the rewritten edge/CLI wiring
  end to end: a handful of hops through every step kind of one inline flow,
  the `gtd next --json` contract, and a custom `gtd.config.ts` workflow whose
  sign-off, closed by its unpin beat, lands an ordinary commit entering its
  initial state, retaining every prior turn commit. Comprehensive coverage
  (every state, retry/escalation, the full check/fix/review tail, both
  refusal shapes) has its own dedicated feature files — see refusals.feature
  and retry.feature.

  Scenario: a happy path advances idle -> checking -> designing -> approving -> judging -> applying -> idle
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, check, human, judge, read, removeScript, run } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "No active gtd process." })
        await check("checking", "true", ".gtd/FEEDBACK.md")
        await agent("designing", "Write .gtd/REQUIREMENTS.md.")
        await human("approving", {
          message: "Read .gtd/REQUIREMENTS.md, then land.",
          acceptClean: true,
        })
        const { answers } = await judge("judging", {
          questions: [
            {
              id: "shape",
              primitive: "choice",
              instructions: "Should the change land?",
              criteria: "land: keep it. drop: discard it.",
            },
          ],
          evidence: { requirements: read(".gtd/REQUIREMENTS.md") ?? "" },
        })
        const drop = answers.shape?.answer === "land" ? ".gtd/REQUIREMENTS.md" : "src/feature.ts"
        await run("applying", removeScript([drop]))
      }
      """
    And a file "src/feature.ts" with:
      """
      export const feature = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → checking"
    And I run the pin beat
    # The green check: a clean tree (the command passes) advances to designing.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking → designing"
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Add a feature.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): designing → approving"
    # An acceptClean human gate lands clean.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): approving → judging"
    Given a file "answers.json" with:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider fixed --answers answers.json | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): judging → applying"
    Given the file "answers.json" is deleted
    # applying: the printed script removes what the judge's answer chose.
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): applying → unpin"
    And I run the unpin beat
    And the last commit subject is "gtd(check): unpin → idle"
    And ".gtd/REQUIREMENTS.md" does not exist
    And "src/feature.ts" exists

  Scenario: gtd next --json reports state, actor, kind, and content
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "No active gtd process." })
        await agent("working", "do it")
      }
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"idle\""
    And stdout contains "\"actor\":\"human\""
    And stdout contains "\"kind\":\"message\""
    And stdout contains "No active gtd process."

  Scenario: a custom workflow's sign-off lands an ordinary commit into idle, retaining every turn commit
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "develop the note, then sign off")
      }
      """
    And I record the commit count
    And a file "NOTE.md" with:
      """
      Remember the milk.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"
    And I run the pin beat
    Given a file "src/milk.ts" with:
      """
      export const milk = "remembered"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → unpin"
    And I run the unpin beat
    And the last commit subject is "gtd(check): unpin → idle"
    And "NOTE.md" exists
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"idle\":true"
    # both turn commits and the pin and unpin beats stay on the branch — no
    # collapse.
    And the commit count increased by 4
