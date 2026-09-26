Feature: judgeBudgetBytes bounds a judge's evidence, and truncation is visible at the gate

  A judge step's evidence is cut to `judgeBudgetBytes`, split evenly across
  its keys, each value keeping its end on a line boundary. When a cut
  actually drops bytes, gtd appends a FIXED sentence to the gate's rendered
  message — never when nothing truncated — and the flow reads which keys
  were cut from the judgment's `truncated`.

  @inmem
  Scenario: evidence the budget cuts gets a truncation notice on the gate's message
    Given a test project
    And a file "BIG.md" padded to at least 2000 bytes with a repeating line
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, judge, read, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        async () => {
          await judge("idle", {
            questions: [{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }],
            evidence: { doc: read("BIG.md") ?? "" },
            message: "hi",
          })
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
  Scenario: evidence within the budget leaves the gate's message byte-identical, no notice
    Given a test project
    And a file "SMALL.md" with:
      """
      short
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, judge, read, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        async () => {
          await judge("idle", {
            questions: [{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }],
            evidence: { doc: read("SMALL.md") ?? "" },
            message: "hi",
          })
          await human("done", { message: "chore: done" })
        },
        { vars: { judgeBudgetBytes: "500" } },
      )
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "hi"
    And stdout does not contain "truncated"

  @inmem
  Scenario: the budget is split across evidence keys, and the flow reads which ones were cut
    Given a test project
    And a file "BIG.md" padded to at least 2000 bytes with a repeating line
    And a file "SMALL.md" with:
      """
      short
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, judge, read, workflow } from "@pmelab/gtd/flows"

      export default workflow(
        async () => {
          const { truncated } = await judge("idle", {
            questions: [{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }],
            evidence: { big: read("BIG.md") ?? "", small: read("SMALL.md") ?? "" },
            message: "hi",
          })
          if (truncated.join(",") === "big") await human("big-cut", { message: "only big was cut" })
          else await human("other", { message: truncated.join(",") })
        },
        { vars: { judgeBudgetBytes: "500" } },
      )
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): idle → big-cut"
