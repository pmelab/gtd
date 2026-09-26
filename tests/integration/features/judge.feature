Feature: gtd judge / gtd judge answer — the judgment surface's CLI plumbing

  `gtd judge` is a read-only peek at the resolved rest's pending judgment
  (the same `judge` field `gtd next --json` already carries); `gtd judge
  answer` reads a verdict off stdin and decodes it against the pending
  judgment's own question ids, landing it with a `Gtd-Judge:` trailer. Both
  refuse through the ordinary error envelope when the resolved rest is not a
  `judge()` step.

  The human fallback: a judge step is an ordinary `message` rest. Landing it
  with no `gtd judge answer` ever run resolves the `judge()` call with every
  answer `undefined` — the flow's conservative branch — and carries no `Gtd-Judge:`
  trailer, which is the only signal telling a skipped judgment apart from one
  answered conservatively.

  @inmem
  Scenario: gtd judge prints the rendered judgment, without mutating anything
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, judge, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await judge("idle", {
          questions: [{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }],
          evidence: { note: "idle" },
          message: "hi",
        })
        await agent("working", "go")
      })
      """
    And a gtd config file at ".gtdrc" with:
      """
      vars: {}
      """
    When I run gtd with args "judge"
    Then it succeeds
    And stdout contains "q1"
    And the last commit subject is "chore: add .gtdrc"

  @inmem
  Scenario: gtd judge refuses through the ordinary error envelope when the resolved rest declares no judge:
    Given a test project
    And the workflow
    When I run gtd with args "judge"
    Then it fails
    And stdout is empty
    And stderr contains "declares no"

  @inmem
  Scenario: gtd judge answer decodes a verdict piped on stdin, against the pending question ids
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, judge, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await judge("idle", {
          questions: [{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }],
          evidence: { note: "idle" },
          message: "hi",
        })
        await agent("working", "go")
      })
      """
    When I run gtd with args "judge answer" and stdin:
      """
      [{"id":"q1","answer":true,"p":0.97}]
      """
    Then it succeeds

  @inmem
  Scenario: gtd judge answer refuses when the piped verdict names a question the pending judgment never declared
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, judge, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await judge("idle", {
          questions: [{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }],
          evidence: { note: "idle" },
          message: "hi",
        })
        await agent("working", "go")
      })
      """
    When I run gtd with args "judge answer" and stdin:
      """
      [{"id":"not-a-real-question","answer":true,"p":0.97}]
      """
    Then it fails
    And stderr contains "does not match the pending questions"

  @live
  Scenario: gtd judge answer decodes a verdict piped into a REAL gtd subprocess
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, judge, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await judge("idle", {
          questions: [{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }],
          evidence: { note: "idle" },
          message: "hi",
        })
        await agent("working", "go")
      })
      """
    When I run gtd with args "judge answer" and stdin:
      """
      [{"id":"q1","answer":true,"p":0.97}]
      """
    Then it succeeds

  @inmem
  Scenario: a judgment skipped entirely lands on the state's own conservative "C" edge, with no Gtd-Judge: trailer
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judge, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "do the work described in NOTE.md")
        await judge("review", {
          questions: [{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }],
          evidence: { note: "review" },
          message:
            "run `gtd judge answer` and paste a verdict, or land with a clean tree to accept the conservative default",
        })
        await agent("conservative", "the conservative path")
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"

    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → review"

    # Land the judge rest with a clean tree and no `gtd judge answer` ever
    # run — no `Gtd-Judge:` trailer exists anywhere in this process's
    # history, so this is the SKIPPED case, not one answered conservatively.
    # The judge call's answers are all undefined and the flow continues on its
    # conservative path.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): review → conservative"
    And the last commit body does not contain "Gtd-Judge:"

  # The judged-retry shape: a red check reaches the `judge` step only once a
  # PRIOR round exists; an "identical" answer at p >= 0.5 escalates, any
  # other answer (or none) falls through to the fix step, and a plain loop
  # counter caps the fix rounds. Both scenarios below share this workflow.
  @inmem
  Scenario: an aware driver answers "identical" and the retry loop ends before the cap
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, judge, read, run, workflow } from "@pmelab/gtd/flows"

      const wrote = (path: string): boolean => changes(path).some((c) => c.status !== "deleted")

      export default workflow(async () => {
        await human("start", { message: "go" })
        let fixes = 0
        for (;;) {
          await run("checking", "npm test")
          let stuck = false
          if (wrote(".gtd/PRIOR_FEEDBACK.md")) {
            const { answers } = await judge("judge", {
              questions: [
                {
                  id: "verdict",
                  primitive: "choice",
                  instructions: "identical, new-failure, or progress",
                  criteria: "identical: same failure restated",
                },
              ],
              evidence: {
                current: read(".gtd/FEEDBACK.md") ?? "",
                previous: read(".gtd/PRIOR_FEEDBACK.md") ?? "",
              },
              message:
                "run `gtd judge answer` and paste a verdict, or land with a clean tree to retry the fix",
            })
            const verdict = answers.verdict
            stuck = verdict?.answer === "identical" && verdict.p >= 0.5
          } else if (!wrote(".gtd/FEEDBACK.md")) {
            break
          }
          if (stuck || fixes >= 2) {
            await human("escalate", { message: "stuck" })
            break
          }
          fixes++
          await agent("fixing", "fix it")
        }
        await human("done", { message: "done" })
      })
      """
    And a file "NOTE.md" with:
      """
      go
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → checking"

    # Round 1: no .gtd/PRIOR_FEEDBACK.md written — bypasses the judge
    # entirely, straight to fixing. The first red round pays for no judgment.
    Given a file ".gtd/FEEDBACK.md" with:
      """
      boom (round 1)
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking → fixing"

    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): fixing → checking"

    # Round 2: checking (the driver, standing in for the check script)
    # writes .gtd/PRIOR_FEEDBACK.md with the SAME content as the fresh
    # FEEDBACK.md, so an aware driver piping this to a judge model would
    # genuinely see "identical".
    Given a file ".gtd/PRIOR_FEEDBACK.md" with:
      """
      boom (round 1)
      """
    And a file ".gtd/FEEDBACK.md" with:
      """
      boom (round 1)
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking → judge"

    # The aware driver answers "identical" at p >= 0.5 — the flow escalates
    # immediately, even though its fix counter (cap 2) has room for another
    # round.
    When I run gtd judge answer with stdin:
      """
      [{"id":"verdict","answer":"identical","p":0.95}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): judge → escalate"
    And the last commit body contains "Gtd-Judge:"

  @inmem
  Scenario: an unaware driver never runs `gtd judge answer` — the same judge beat lands as a plain message to a human, on the ordinary conservative edge
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, judge, read, run, workflow } from "@pmelab/gtd/flows"

      const wrote = (path: string): boolean => changes(path).some((c) => c.status !== "deleted")

      export default workflow(async () => {
        await human("start", { message: "go" })
        let fixes = 0
        for (;;) {
          await run("checking", "npm test")
          let stuck = false
          if (wrote(".gtd/PRIOR_FEEDBACK.md")) {
            const { answers } = await judge("judge", {
              questions: [
                {
                  id: "verdict",
                  primitive: "choice",
                  instructions: "identical, new-failure, or progress",
                  criteria: "identical: same failure restated",
                },
              ],
              evidence: {
                current: read(".gtd/FEEDBACK.md") ?? "",
                previous: read(".gtd/PRIOR_FEEDBACK.md") ?? "",
              },
              message:
                "run `gtd judge answer` and paste a verdict, or land with a clean tree to retry the fix",
            })
            const verdict = answers.verdict
            stuck = verdict?.answer === "identical" && verdict.p >= 0.5
          } else if (!wrote(".gtd/FEEDBACK.md")) {
            break
          }
          if (stuck || fixes >= 2) {
            await human("escalate", { message: "stuck" })
            break
          }
          fixes++
          await agent("fixing", "fix it")
        }
        await human("done", { message: "done" })
      })
      """
    And a file "NOTE.md" with:
      """
      go
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → checking"

    Given a file ".gtd/FEEDBACK.md" with:
      """
      boom (round 1)
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking → fixing"

    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): fixing → checking"

    Given a file ".gtd/PRIOR_FEEDBACK.md" with:
      """
      boom (round 1)
      """
    And a file ".gtd/FEEDBACK.md" with:
      """
      boom, but different this time (round 2)
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking → judge"

    # The named acceptance scenario itself: "shown as a plain message to a
    # human" means kind: "message" and the message text on stdout — not just
    # a routing outcome an unaware driver happens to also produce.
    When I run gtd next with "--json=kind"
    Then it succeeds
    And stdout matches "^message\n$"
    When I run gtd next
    Then it succeeds
    And stdout contains "run `gtd judge answer` and paste a verdict"

    # An unaware driver ignores the `judge` document, reads only the message,
    # and lands with a clean tree — no `gtd judge answer` ever ran, so the
    # judge call's answers are undefined and the flow takes its conservative
    # branch: another fix round.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): judge → fixing"
    And the last commit body does not contain "Gtd-Judge:"

  # A `judge()` step always authenticates as the `judge` actor — no human
  # can answer a judgment.
  @inmem
  Scenario: gtd next --json=actor at a judge gate reports "judge", not "human"
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, judge, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await judge("verdict", {
          questions: [{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }],
          evidence: { note: "verdict" },
          message:
            "run `gtd judge answer` and paste a verdict, or land to accept the conservative default",
        })
        await human("done", { message: "chore: done" })
      })
      """
    When I run gtd next with "--json=actor"
    Then it succeeds
    And stdout matches "^judge\n$"

  @inmem
  Scenario: a verdict landed at a judge gate writes a gtd(judge): subject
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, judge, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await judge("verdict", {
          questions: [{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }],
          evidence: { note: "verdict" },
          message:
            "run `gtd judge answer` and paste a verdict, or land to accept the conservative default",
        })
        await human("done", { message: "chore: done" })
      })
      """
    When I run gtd judge answer with stdin:
      """
      [{"id":"q1","answer":true,"p":0.97}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): verdict → done"
    And the last commit body contains "Gtd-Judge:"

  @inmem
  Scenario: a bare gtd land at a judge gate (no verdict piped) still authenticates as the judge actor — the skipped-judgment path is a judge commit, not a human one
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, judge, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await judge("verdict", {
          questions: [{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }],
          evidence: { note: "verdict" },
          message:
            "run `gtd judge answer` and paste a verdict, or land to accept the conservative default",
        })
        await human("done", { message: "chore: done" })
      })
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): verdict → done"
    And the last commit body does not contain "Gtd-Judge:"
