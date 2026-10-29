Feature: gtd history judges — how often the kept processes' judge verdicts were overturned

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judge, scope } from "@pmelab/gtd/flows"

      export const defaults = { qualityTriageMinP: "0.7" }

      const finding = (id: string) => ({ id, primitive: "choice", instructions: "i", criteria: "c" })

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await scope("build", async () => {
          await scope("quality", async () => {
            await agent("reviewing", "review it")
            await judge("triage", {
              questions: [finding("Q1"), finding("Q2")],
              evidence: {},
              message: "triage the findings",
            })
          })
          await agent("composing", "compose the review")
          await human("review", { message: "review it" })
        })
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → build.quality.reviewing"
    And a file ".gtd/QUALITY.md" with:
      """
      ## a stray export

      Export it.

      ## a missing test

      Add one.
      """
    And gtd lands "gtd(agent): build.quality.reviewing → build.quality.triage"
    And gtd lands "gtd(judge): build.quality.triage → build.composing" judging:
      """
      [{"id":"Q1","answer":"mechanical","p":0.95},{"id":"Q2","answer":"noise","p":0.85}]
      """
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      ## Fixed automatically

      - a stray export (abc1234)

      ## Dropped as noise

      - a missing test (p=0.85)
      """
    And gtd lands "gtd(agent): build.composing → build.review"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      ## Fixed automatically

      - a stray export (abc1234)

      ## Dropped as noise

      - a missing test (p=0.85) — not noise, we need that test
      """
    And gtd lands "gtd(human): build.review → idle"

  @inmem
  Scenario: a dropped finding the human wrote back on is overturned, per p bucket
    When I run gtd with args "history judges main"
    Then it succeeds
    And stdout contains "triage: 2 verdicts, 2 scored, 1 overturned (0.8-0.9: 1/1, 0.9-1.0: 0/1)"
    And stdout contains "retry: 0 verdicts, 0 scored, 0 overturned"
    And stdout contains "clear: 0 verdicts, 0 scored, 0 overturned"
    When I run gtd with args "history judges --json=total.judges.triage.overturned"
    Then it succeeds
    And stdout is:
      """
      1
      """

  @inmem
  Scenario: --var re-decides past verdicts under another threshold, with no model call
    When I run gtd with args "history judges --var qualityTriageMinP=0.9"
    Then it succeeds
    And stdout contains "what-if qualityTriageMinP=0.9: 1 noise drop becomes a note (1 overturned)"
    When I run gtd with args "history judges --var qualityTriageMinP=0.5"
    Then stdout contains "what-if qualityTriageMinP=0.5: no decision changes"

  @inmem
  Scenario: --threshold re-decides past verdicts the same way --var, its deprecated spelling, does
    When I run gtd with args "history judges --threshold qualityTriageMinP=0.9"
    Then it succeeds
    And stdout contains "what-if qualityTriageMinP=0.9: 1 noise drop becomes a note (1 overturned)"
    When I run gtd with args "history judges --threshold=qualityTriageMinP=0.9 --var qualityTriageMinP=0.8"
    Then the exit code is 2
    And stderr contains "qualityTriageMinP given as both --threshold and --var"
    When I run gtd with args "history judges --threshold reviewBase=main"
    Then the exit code is 2
    And stderr contains "--threshold reviewBase is no judge threshold"

  @inmem
  Scenario: --var takes judge thresholds only
    When I run gtd with args "history judges --var reviewBase=main"
    Then the exit code is 2
    And stderr contains "no judge threshold"

  @inmem
  Scenario: --jsonl exports one line per verdict, with the evidence and outcome
    When I run gtd with args "history judges --jsonl"
    Then it succeeds
    And stdout contains "\"judge\":\"triage\",\"commit\":"
    And stdout contains "\"question\":\"Q2\",\"state\":{\"Q2\":\"## a missing test\n\nAdd one.\"},\"answer\":\"noise\",\"p\":0.85,\"outcome\":\"overturned\"}"
    And stdout contains "\"question\":\"Q1\",\"state\":{\"Q1\":\"## a stray export\n\nExport it.\"},\"answer\":\"mechanical\",\"p\":0.95,\"outcome\":\"held\"}"

  @inmem
  Scenario: an identical retry verdict is overturned when the next fix turn's check goes green
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, check, human, judge, scope } from "@pmelab/gtd/flows"

      const verdict = { id: "verdict", primitive: "choice", instructions: "i", criteria: "c" }

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await scope("build", async () => {
          let red = 0
          while (!(await scope("health", () => check("check", "npm test", { report: ".gtd/FEEDBACK.md" })))) {
            if (++red > 1)
              await scope("health", () => judge("judge", { questions: [verdict], evidence: {}, message: "same?" }))
            await agent("fix", "fix it")
          }
        })
      }
      """
    And the working tree is committed as "chore: retry config"
    And a file "NOTE.md" with:
      """
      Fix a thing.
      """
    And gtd lands "gtd(human): idle → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 failing
      """
    And gtd lands "gtd(check): build.health.check → build.fix"
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 failing, still
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    And gtd lands "gtd(judge): build.health.judge → build.fix" judging:
      """
      [{"id":"verdict","answer":"identical","p":0.95}]
      """
    And a file "src/a.ts" with:
      """
      export const a = 2
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And the file ".gtd/FEEDBACK.md" is deleted
    And gtd lands "gtd(check): build.health.check → idle"
    When I run gtd with args "history judges"
    Then it succeeds
    And stdout contains "retry: 1 verdicts, 1 scored, 1 overturned (0.9-1.0: 1/1)"
    When I run gtd with args "history judges --jsonl"
    Then stdout contains "\"state\":{\"previous\":\"1 failing\n\",\"current\":\"1 failing, still\n\"}"

  @inmem
  Scenario: a design skip is overturned when a later design gate edits the criteria
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judge, scope } from "@pmelab/gtd/flows"

      const clear = { id: "clear", primitive: "noul", instructions: "i", criteria: "c" }

      export default async () => {
        await human("idle", { message: "write TODO.md to start a process" })
        await scope("design", async () => {
          await judge("clear", { questions: [clear], evidence: {}, message: "clear?" })
          await agent("normalise", "record the stated criteria")
          await human("gate", { message: "narrow the criteria" })
        })
      }
      """
    And the working tree is committed as "chore: clear config"
    And a file "TODO.md" with:
      """
      Acceptance criteria:

      - it works
      """
    And gtd lands "gtd(human): idle → design.clear"
    And gtd lands "gtd(judge): design.clear → design.normalise" judging:
      """
      [{"id":"clear","answer":"yes","p":0.9}]
      """
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: it works
      """
    And gtd lands "gtd(agent): design.normalise → design.gate"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: it works on an empty list
      """
    And gtd lands "gtd(human): design.gate → idle"
    When I run gtd with args "history judges"
    Then it succeeds
    And stdout contains "clear: 1 verdicts, 1 scored, 1 overturned (0.9-1.0: 1/1)"
    When I run gtd with args "history judges --jsonl"
    Then stdout contains "\"state\":{\"sketch\":\"Acceptance criteria:\n\n- it works\n\"}"
