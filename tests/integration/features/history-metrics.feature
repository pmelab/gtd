Feature: gtd history metrics — how kept processes went, read from refs/gtd/history

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await scope("seam", async () => {
          await agent("naive", "write the naive pass")
          await scope("continue", () => agent("naive", "continue the naive pass"))
        })
        await scope("implement", () => agent("building", "rebuild it"))
        await scope("build", () =>
          scope("quality", () => scope("correctness", () => agent("reviewing", "review it"))),
        )
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → seam.naive"
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And gtd lands "gtd(agent): seam.naive → seam.continue.naive" with "--cost 0.4 --model coder"
    And a file "src/b.ts" with:
      """
      export const b = 2
      """
    And gtd lands "gtd(agent): seam.continue.naive → implement.building" with "--cost 0.2 --model coder"
    And a file "src/c.ts" with:
      """
      export const c = 3
      """
    And gtd lands "gtd(agent): implement.building → build.quality.correctness.reviewing" with "--cost 0.5 --model coder"
    And a file ".gtd/QUALITY.md" with:
      """
      ## a stray export

      ## a missing test
      """
    And gtd lands "gtd(agent): build.quality.correctness.reviewing → idle" with "--cost 0.1 --model reviewer"

  @inmem
  Scenario: a rebuilt naive pass reports its refactor-first rate, continuation, double work and findings
    When I run gtd with args "history metrics main"
    Then it succeeds
    And stdout contains "main: 1 slices, 1 rebuilt (refactor-first 100%), 0 refactored"
    And stdout contains "1 continuations (seam.naive 1)"
    And stdout contains "cost 1.2 (naive 0.6, refactor 0, implement 0.5, other 0.1; by model coder 1.1, reviewer 0.1), double work 1.1"
    And stdout contains "2 findings (build.quality.correctness 2)"
    And stdout contains "total (1 processes)"

  @inmem
  Scenario: --json selects one value of the totals, cost per model included
    When I run gtd with args "history metrics --json=total.cost.byModel.coder"
    Then it succeeds
    And stdout is:
      """
      1.1
      """
    When I run gtd with args "history metrics --json=total.cost.doubleWork.naive"
    Then stdout is:
      """
      0.6
      """

  @inmem
  Scenario: a config edited since the process finished is no refusal
    Given the file "gtd.config.ts" ends with:
      """
      // edited after the process finished
      """
    When I run gtd with args "history metrics --json=total.refactorFirstRate"
    Then it succeeds
    And stdout is:
      """
      1
      """

  @inmem
  Scenario: a branch name measures every process kept from that branch
    Given a file "NOTE.md" with:
      """
      Build another thing.
      """
    And gtd lands "gtd(human): idle → seam.naive"
    And a file "src/d.ts" with:
      """
      export const d = 4
      """
    And gtd lands "gtd(agent): seam.naive → seam.continue.naive"
    And a file "src/e.ts" with:
      """
      export const e = 5
      """
    And gtd lands "gtd(agent): seam.continue.naive → implement.building"
    And a file "src/f.ts" with:
      """
      export const f = 6
      """
    And gtd lands "gtd(agent): implement.building → build.quality.correctness.reviewing"
    And a file "src/g.ts" with:
      """
      export const g = 7
      """
    And gtd lands "gtd(agent): build.quality.correctness.reviewing → idle"
    When I run gtd with args "history metrics main --json=total.processes"
    Then it succeeds
    And stdout is:
      """
      2
      """

  @inmem
  Scenario: a ref that matches no kept process fails
    When I run gtd with args "history metrics nope"
    Then the exit code is 1
    And stderr contains "no history ref matches \"nope\""

  @inmem
  Scenario: a red check that passed on its re-check is counted as flaky
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"
      import { gate } from "@pmelab/gtd/workflows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await gate("start-gate", "the baseline is red")
      }
      """
    And the working tree is committed as "chore: gated config"
    And a file "NOTE.md" with:
      """
      Gate a thing.
      """
    And gtd lands "gtd(human): idle → start-gate.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 test timed out
      """
    And gtd lands "gtd(check): start-gate.check → start-gate.recheck"
    And the file ".gtd/FEEDBACK.md" is deleted
    And gtd lands "gtd(check): start-gate.recheck → idle"
    When I run gtd with args "history metrics main"
    Then it succeeds
    And stdout contains "1 flaky (start-gate.check 1)"
    When I run gtd with args "history metrics --json=total.flaky.total"
    Then stdout is:
      """
      1
      """
