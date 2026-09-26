Feature: it.tail/it.diffTail bound a judge:'s payload, and truncation is visible at the gate

  `tail(path, share)` cuts a judge step's evidence to a
  `judgeBudgetBytes`-derived share, on a line boundary. When a bounded read
  actually drops bytes, gtd appends a FIXED sentence to the gate's rendered
  message — never when nothing truncated.

  @inmem
  Scenario: a judge: field whose it.tail truncates gets a truncation notice on the gate's message
    Given a test project
    And a file "BIG.md" padded to at least 2000 bytes with a repeating line
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, judge, tail, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        async () => {
          await judge(
            "idle",
            { id: "q1", primitive: "noul", instructions: "i", criteria: "c" },
            tail("BIG.md", 1),
            { message: "hi" },
          )
          await human("done", { message: "chore: done" })
        },
        { vars: { judgeBudgetBytes: "500" } },
      )
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "hi"
    And stdout contains "some evidence above was truncated to fit the judge's payload budget"

  @inmem
  Scenario: a judge: field whose it.tail does NOT truncate leaves the gate's message byte-identical, no notice
    Given a test project
    And a file "SMALL.md" with:
      """
      short
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, judge, tail, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        async () => {
          await judge(
            "idle",
            { id: "q1", primitive: "noul", instructions: "i", criteria: "c" },
            tail("SMALL.md", 1),
            { message: "hi" },
          )
          await human("done", { message: "chore: done" })
        },
        { vars: { judgeBudgetBytes: "500" } },
      )
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "hi"
    And stdout does not contain "truncated"
