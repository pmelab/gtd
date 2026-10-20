@inmem
Feature: a red check is re-run once before it reaches a person

  Before the fix loop escalates, `healthy` re-runs the suite as
  `health.recheck`. Green there ends the loop as if the check had passed, and
  the re-check's landing records `Gtd-Mark: flaky=health.check`. Red again
  escalates as before.

  Background:
    Given a gtd config with:
      """
      import { healthy } from "@pmelab/gtd/workflows"
      import { agent, human } from "@pmelab/gtd/flows"

      export const held = async () => {
        await agent("first", "go")
        await healthy(() => agent("fix", "go"))
        await human("done")
      }
      export default held
      """
    And step "first" writes "src/a.ts" with:
      """
      export const a = 1
      """
    And step "health.check" writes ".gtd/FEEDBACK.md" with:
      """
      1 test failing
      """
    And step "fix" deletes ".gtd/FEEDBACK.md"
    And judge step "health.judge" answers:
      """
      [{"id":"verdict","answer":"progress","p":0.9}]
      """

  Scenario: a re-check that passes ends the loop without a person, recorded as flaky
    Given step "health.recheck" deletes ".gtd/FEEDBACK.md"
    When gtd starts workflow "held"
    And the process is driven
    Then the process rests at "done"
    And the commit subjects end with:
      """
      gtd(agent): fix → health.check
      gtd(check): health.check → health.judge
      gtd(judge): health.judge → health.recheck
      gtd(check): health.recheck → done
      """
    And the last commit body contains "Gtd-Mark: flaky=health.check"
    And ".gtd/FEEDBACK.md" does not exist

  Scenario: a re-check that stays red escalates, with nothing recorded as flaky
    Given step "health.recheck" writes ".gtd/FEEDBACK.md" with:
      """
      1 test still failing
      """
    When gtd starts workflow "held"
    And the process is driven
    Then the process rests at "health.describe"
    And the last commit subject is "gtd(check): health.recheck → health.describe"
    And no commit body contains "Gtd-Mark: flaky="
