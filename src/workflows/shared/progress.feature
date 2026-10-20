@inmem
Feature: a fix loop still making progress at the cap gets one extra turn

  `healthy` escalates once three fix turns are spent. When `health.judge`
  calls that round progress — still red, but closer to green — with at least
  `judgeIdenticalMinP` confidence, one more fix runs first, once per run of
  fixes. The round after it escalates without asking the judge. Any other
  verdict escalates at the cap as before.

  Background:
    Given a gtd config with:
      """
      import { healthy } from "@pmelab/gtd/workflows"
      import { agent } from "@pmelab/gtd/flows"

      export const defaults = { judgeIdenticalMinP: "0.7" }
      export const held = async () => {
        await agent("first", "go")
        await healthy(() => agent("fix", "go"))
      }
      export default held
      """
    And step "first" writes "src/a.ts" with:
      """
      export const a = 1
      """
    And step "health.check" writes ".gtd/FEEDBACK.md" with:
      """
      tests failing
      """
    And step "fix" deletes ".gtd/FEEDBACK.md"
    And step "health.recheck" writes ".gtd/FEEDBACK.md" with:
      """
      tests still failing
      """

  Scenario: progress at the cap buys exactly one extra fix turn
    Given judge step "health.judge" answers:
      """
      [{"id":"verdict","answer":"progress","p":0.9}]
      """
    When gtd starts workflow "held"
    And the process is driven
    Then the process rests at "health.describe"
    And the commit subjects end with:
      """
      gtd(agent): first → health.check
      gtd(check): health.check → fix
      gtd(agent): fix → health.check
      gtd(check): health.check → health.judge
      gtd(judge): health.judge → fix
      gtd(agent): fix → health.check
      gtd(check): health.check → health.judge
      gtd(judge): health.judge → fix
      gtd(agent): fix → health.check
      gtd(check): health.check → health.judge
      gtd(judge): health.judge → fix
      gtd(agent): fix → health.check
      gtd(check): health.check → health.recheck
      gtd(check): health.recheck → health.describe
      """

  Scenario Outline: <verdict> at <p> escalates at the cap without an extra turn
    Given judge step "health.judge" answers:
      """
      [{"id":"verdict","answer":"<verdict>","p":<p>}]
      """
    When gtd starts workflow "held"
    And the process is driven
    Then the process rests at "health.describe"
    And the commit subjects end with:
      """
      gtd(agent): first → health.check
      gtd(check): health.check → fix
      gtd(agent): fix → health.check
      gtd(check): health.check → health.judge
      gtd(judge): health.judge → fix
      gtd(agent): fix → health.check
      gtd(check): health.check → health.judge
      gtd(judge): health.judge → fix
      gtd(agent): fix → health.check
      gtd(check): health.check → health.judge
      gtd(judge): health.judge → health.recheck
      gtd(check): health.recheck → health.describe
      """

    Examples:
      | verdict     | p   |
      | new-failure | 0.9 |
      | progress    | 0.5 |

  Scenario: a person's escalation stop starts a new run of fixes with its own extra turn
    Given judge step "health.judge" answers:
      """
      [{"id":"verdict","answer":"progress","p":0.9}]
      """
    And step "health.describe" writes ".gtd/ESCALATION.md" with:
      """
      try something else
      """
    And step "health.stop" writes "NOTES.md" with:
      """
      narrowed
      """
    When gtd starts workflow "held"
    And the process is driven
    Then the process rests at "health.exhausted"
    And the commit subjects end with:
      """
      gtd(agent): health.describe → health.stop
      gtd(human): health.stop → fix
      gtd(agent): fix → health.check
      gtd(check): health.check → health.judge
      gtd(judge): health.judge → fix
      gtd(agent): fix → health.check
      gtd(check): health.check → health.judge
      gtd(judge): health.judge → fix
      gtd(agent): fix → health.check
      gtd(check): health.check → health.judge
      gtd(judge): health.judge → fix
      gtd(agent): fix → health.check
      gtd(check): health.check → health.recheck
      gtd(check): health.recheck → health.exhausted
      """
