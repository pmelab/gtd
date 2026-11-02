@inmem
Feature: an inline flow end to end — qualified names, process boundaries, read-only rests

  A scope nested inside a scope qualifies its steps with both prefixes, and a
  flow fragment's "where to go when done" is just the code after it. A flow
  that runs to its end lands at its unpin beat, whose landing goes back to its
  first step and is a process boundary: the next process replays from there,
  so nothing a flow counts carries over from the previous process. Reading a
  rest never writes git.

  Scenario: a two-level nested scope qualifies its steps across both levels
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, scope } from "@pmelab/gtd/flows"

      const leaf = () => scope("inner", () => agent("work", "do the work"))

      const mid = async () => {
        await human("gate", { message: "approve?" })
        await leaf()
      }

      export default async () => {
        await human("idle", { message: "start" })
        await scope("nested", mid)
        await human("done", { message: "done" })
      }
      """
    And a file "NOTE.md" with:
      """
      kick off
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → nested.gate"
    When I run the pin beat
    Given a file "NOTE.md" with:
      """
      approved
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): nested.gate → nested.inner.work"
    When I run gtd next
    Then it succeeds
    And stdout contains "do the work"
    # leaf returns, then mid returns, and the root flow carries on to its own
    # "done" step two levels up.
    Given a file "NOTE.md" with:
      """
      done
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): nested.inner.work → done"

  Scenario: a flow that ends lands at idle, and the next process counts from zero
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, check, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        let fixes = 0
        while (!(await check("check", "npm test", ".gtd/FEEDBACK.md"))) {
          if (++fixes > 2) {
            await human("stuck", { message: "too many fixes" })
            return
          }
          await agent("fix", "fix it")
        }
      }
      """
    # Process 1 spends both of its fixes, then goes green and ends at idle.
    And a file "NOTE.md" with:
      """
      process 1
      """
    And gtd lands "gtd(human): idle → check"
    And I run the pin beat
    And a file ".gtd/FEEDBACK.md" with:
      """
      process 1 attempt 1 failed
      """
    And gtd lands "gtd(check): check → fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/fix.ts" with:
      """
      export const fix = 1
      """
    And gtd lands "gtd(agent): fix → check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      process 1 attempt 2 failed
      """
    And gtd lands "gtd(check): check → fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/fix.ts" with:
      """
      export const fix = 2
      """
    And gtd lands "gtd(agent): fix → check"
    And gtd lands "gtd(check): check → gtd:unpin"
    And I run the unpin beat
    # Process 2: had the count pooled across the boundary, its first red run
    # would already be over the cap.
    And a file "NOTE.md" with:
      """
      process 2
      """
    And gtd lands "gtd(human): idle → check"
    And I run the pin beat
    Given a file ".gtd/FEEDBACK.md" with:
      """
      process 2 attempt 1 failed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): check → fix"

  Scenario: gtd next at a human rest leaves HEAD untouched and writes no worktree ref
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await agent("reviewing", "review it", { file: ".gtd/REVIEW.md" })
        await human("await-review", { message: "read the review", file: ".gtd/REVIEW.md" })
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → reviewing"
    And I run the pin beat
    And a file ".gtd/REVIEW.md" with:
      """
      the review
      """
    And gtd lands "gtd(agent): reviewing → await-review"
    Given I mark the current commit as "before"
    When I run gtd next
    Then it succeeds
    And the current commit is the same as "before"
    And no ref under "refs/worktree/gtd/" was created
