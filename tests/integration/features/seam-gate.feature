Feature: seamGate — a refactor-first judgment rests at a human approval gate

  `seamGate(name, shape)` rests at `human(name, { approve: true })` only when
  the judged shape is `refactor-first`; `land` and `reject` reach no step. The
  gate's message is the seam report. A clean `gtd land` approves it and the
  commit records `Gtd-Approved`; a landing with any edit is refused.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judgeDiffShape, seamGate } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        const first = await judgeDiffShape("shape", {
          changes: [
            { path: "z/new.ts", status: "added", before: undefined, after: "z" },
            { path: "a/old.ts", status: "deleted", before: "a", after: undefined },
          ],
          allow: [],
        })
        await seamGate("gate", first)
        const second = await judgeDiffShape("again", {
          changes: [{ path: "m/new.ts", status: "added", before: undefined, after: "m" }],
          allow: [],
        })
        await seamGate("gate", second)
        await agent("after", "carry on")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """

  @inmem
  Scenario Outline: a <answer> judgment skips the gate
    Given gtd lands "gtd(human): idle → shape"
    And gtd lands "gtd(judge): shape → again" judging:
      """
      [{"id":"shape","answer":"<answer>","p":0.9}]
      """
    Then the last commit body does not contain "Gtd-Approved:"
    And the process rests at "again"

    Examples:
      | answer |
      | land   |
      | reject |

  @inmem
  Scenario: a refactor-first judgment rests at the gate with the seam report
    Given gtd lands "gtd(human): idle → shape"
    And gtd lands "gtd(judge): shape → gate" judging:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    When I run gtd next with "--json=kind"
    Then stdout is:
      """
      message
      """
    When I run gtd next with "--json=content"
    Then stdout lists "a/old.ts" before "z/new.ts"
    And stdout contains "gtd land"
    And stdout contains "gtd abandon"
    And stdout does not contain "unreadable"

  @inmem
  Scenario: an unreadable stray reaches the gate marked as unreadable
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judgeDiffShape, seamGate } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        const shape = await judgeDiffShape("shape", {
          changes: [{ path: "vendor/big.bin", status: "modified", before: undefined, after: "x" }],
          allow: [],
        })
        await seamGate("gate", shape)
        await agent("after", "carry on")
      }
      """
    And gtd lands "gtd(human): idle → gate"
    When I run gtd next with "--json=content"
    Then stdout contains "vendor/big.bin (unreadable — not judged)"

  @inmem
  Scenario: a clean land approves the gate and records who approved it
    Given gtd lands "gtd(human): idle → shape"
    And gtd lands "gtd(judge): shape → gate" judging:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): gate → again"
    And the last commit body contains 'Gtd-Approved: {"step":"gate#1","name":"Test","email":"test@test.com"}'
    And the last commit body does not contain "Signed-off-by:"
    And the last commit body contains "Gtd-Format: 1"

  @inmem
  Scenario: a tree edited between gtd land and its script fails the script and the gate stays
    Given gtd lands "gtd(human): idle → shape"
    And gtd lands "gtd(judge): shape → gate" judging:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And I record the commit count
    When I save the gtd land script without running it
    And a file "src/edit.ts" with:
      """
      export const edit = 1
      """
    And I run the saved script
    Then it fails
    And stderr contains "the working tree changed since `gtd land`"
    And the commit count is unchanged
    When I run gtd next with "--json=state"
    Then stdout is:
      """
      gate
      """

  @inmem
  Scenario: a dirty land is refused and the gate stays
    Given gtd lands "gtd(human): idle → shape"
    And gtd lands "gtd(judge): shape → gate" judging:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And I record the commit count
    And a file "src/edit.ts" with:
      """
      export const edit = 1
      """
    When I run gtd land
    Then it fails
    And stderr contains "approval-gate: gate#1 approves exactly the judged diff"
    And stderr contains "gtd abandon"
    And the commit count is unchanged
    When I run gtd next with "--json=state"
    Then stdout is:
      """
      gate
      """

  @inmem
  Scenario: an edit staged and then reverted is refused by gtd land, not by the script
    Given a file "src/edit.ts" with:
      """
      export const edit = 1
      """
    And gtd lands "gtd(human): idle → shape"
    And gtd lands "gtd(judge): shape → gate" judging:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And a file "src/edit.ts" with:
      """
      export const edit = 2
      """
    And "src/edit.ts" is staged
    And a file "src/edit.ts" with:
      """
      export const edit = 1
      """
    And I record the commit count
    When I run gtd land
    Then it fails
    And stderr contains "approval-gate: gate#1 approves exactly the judged diff"
    And the commit count is unchanged

  @inmem
  Scenario: after approval the process rests past the gate and a second refactor-first rests as #2
    Given gtd lands "gtd(human): idle → shape"
    And gtd lands "gtd(judge): shape → gate" judging:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    When I run gtd land
    Then it succeeds
    And the process rests at "again"
    Given gtd lands "gtd(judge): again → gate" judging:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    Then the process rests at "gate"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): gate → after"
    And the last commit body contains 'Gtd-Approved: {"step":"gate#2","name":"Test","email":"test@test.com"}'
    And the process rests at "after"

  @inmem
  Scenario: approving a gate whose name contains a step-id separator lands clean and reads back
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await human("phase#1 review", { message: "sign off", approve: true })
        await agent("after", "carry on")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build another thing.
      """
    And gtd lands "gtd(human): idle → phase#1 review"
    When I run gtd land
    Then it succeeds
    And the last commit body contains '"step":"phase#1 review#1"'
    And the process rests at "after"
    When I run gtd next with "--json=approvals.0.step"
    Then stdout is:
      """
      phase#1 review#1
      """

  @inmem
  Scenario: gtd next lists the approval only after the gate is approved
    Given gtd lands "gtd(human): idle → shape"
    And gtd lands "gtd(judge): shape → gate" judging:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    When I run gtd next with "--json"
    Then stdout contains "\"approvals\":[]"
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json=approvals.0.step"
    Then stdout is:
      """
      gate#1
      """
    When I run gtd next with "--json=approvals.0.name"
    Then stdout is:
      """
      Test
      """
    When I run gtd next with "--json=approvals.0.email"
    Then stdout is:
      """
      test@test.com
      """
    When I run gtd next with "--json=approvals.0.commit"
    Then stdout matches "^[0-9a-f]{40}\n$"

  @inmem
  Scenario: a finished process shows who approved the gate in gtd history show
    Given gtd lands "gtd(human): idle → shape"
    And gtd lands "gtd(judge): shape → gate" judging:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And I run gtd land
    And gtd lands "gtd(judge): again → after" judging:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    And a file "src/done.ts" with:
      """
      export const done = 1
      """
    When I run gtd land
    Then it succeeds
    When I run gtd with args "history show main"
    Then it succeeds
    And stdout contains "  approved gate#1 by Test <test@test.com>"
    When I run gtd with args "history show main --json=steps.2.approval.step"
    Then stdout is:
      """
      gate#1
      """

  @inmem
  Scenario: approve combined with mode and file is refused naming the step and both
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("gate", { approve: true, mode: "review", file: ".gtd/REVIEW.md" })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains 'step "gate": approve cannot be combined with mode, file in human() options'
