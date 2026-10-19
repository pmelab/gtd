@inmem
Feature: v3 pattern-machine smoke — one-flow hops, gtd next --json, an ordinary sign-off commit

  Minimal smoke coverage for the v3 CLI (`gtd land` / `gtd next`, see
  src/edge/Edge.ts). Proves the rewritten edge/CLI wiring
  end to end: a handful of hops on the built-in default workflow's one flow,
  the `gtd next --json` contract, and a custom `gtd.config.ts` workflow whose
  sign-off lands an ordinary commit entering its initial state, retaining
  every prior turn commit. Comprehensive coverage (every state, retry/
  escalation, the full check/fix/review tail, both refusal shapes) has its own
  dedicated feature files — see refusals.feature, default-workflow.feature,
  retry.feature.

  Scenario: the one flow's happy path advances idle -> unwind -> start-gate.check -> design.triage -> design.gate.answer -> seam.naive -> seam.judge -> implement.building -> implement.health.check
    Given a test project
    And the workflow gtd install scaffolds
    And a file "src/feature.ts" with:
      """
      export const feature = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"
    # unwind: simulate the revert without running the
    # printed script, by reverting the working tree to the start commit ourselves.
    Given the file "src/feature.ts" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → start-gate.check"
    # The green-baseline gate: a clean tree (tests pass) advances to design.triage.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Add a feature. No open questions.
      """
    When I run gtd land
    Then it succeeds
    # The gate stops even with no open question.
    And the last commit subject is "gtd(agent): design.triage → design.gate.answer"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → seam.naive"
    # The naive pass edits an existing file outside the allowlist: a stray the judge rules on.
    Given a file "README.md" with:
      """
      # test project, with a feature
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): seam.naive → seam.judge"
    Given a file "answers.json" with:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider fixed --answers answers.json | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): seam.judge → implement.building"
    Given the file "answers.json" is deleted
    And a file "src/feature-impl.ts" with:
      """
      export const featureImpl = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): implement.building → implement.health.check"

  Scenario: gtd next --json reports state, actor, kind, and content
    Given a test project
    And the workflow gtd install scaffolds
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
    Given a file "src/milk.ts" with:
      """
      export const milk = "remembered"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → idle"
    And "NOTE.md" exists
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"idle\":true"
    # both turn commits stay on the branch — no collapse.
    And the commit count increased by 2
