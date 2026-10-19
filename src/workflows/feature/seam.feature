@inmem
Feature: the naive pass and seam judge decide how a feature is built

  After design a naive pass is set aside under a kept ref, the judge reads its
  diff, and the process either implements straight away, refactors the seam
  first behind a human approval, or retries the naive pass.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And the gtd config ends with:
      """
      export const config = {
        skills: {
          implement: ["my-tdd", "my-runbook"],
        },
      }
      """
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/calc.test.ts" with:
      """
      import { expect, it } from "vitest"
      it("adds", () => expect(1 + 1).toBe(2))
      """
    And the working tree is committed as "feat: add calculator"
    And a file "TODO.md" with:
      """
      # Add subtract

      subtract(a, b) returns the difference.
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Concerns

      ### Subtract

      - `subtract(a, b)` returns `a - b`.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And step "design.gate.answer" changes nothing

  Scenario: a land judgment goes straight to the implementation with no seam gate or refactor
    Given step "seam.check" changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    When the process is driven
    Then the process rests at "implement.building"
    And the last commit body contains "Gtd-Judge:"
    And the commit subjects end with:
      """
      chore: initial commit
      feat: add calculator
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → implement.building
      """

  Scenario: config skills for the implement scope reach the implement step
    Given step "seam.check" changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    When the process is driven
    Then the process rests at "implement.building"
    And the resting step's content contains "my-tdd, my-runbook"

  Scenario: the naive pass lands as a marker commit and its turn stays off the branch
    Given step "seam.check" changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    When the process is driven
    Then the process rests at "seam.judge"
    And the commit subjects end with:
      """
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      """
    And the commit "gtd(agent): seam.naive → seam.check" has a body containing "Gtd-Kept:"
    And "src/calc.ts" does not contain "subtract"

  Scenario: the implementation is one build turn, a green check, then the requirements are closed out
    Given step "seam.check" changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    And step "implement.building" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      export const SUBTRACT_ENABLED = process.env.GTD_FLAG_SUBTRACT === "1"
      """
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    When the process is driven
    Then the process rests at "idle"
    And the commit subjects end with:
      """
      gtd(judge): seam.judge → implement.building
      gtd(agent): implement.building → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → idle
      """
    And ".gtd/REQUIREMENTS.md" does not exist

  Scenario: a naive pass modifying a test file and adding a new one skips the judge
    Given step "seam.check" changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/subtract.ts" with:
      """
      export const subtract = (a: number, b: number) => a - b
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      import { expect, it } from "vitest"
      it("adds", () => expect(2 + 2).toBe(4))
      """
    When the process is driven
    Then the process rests at "implement.building"
    And the commit subjects end with:
      """
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.building
      """

  Scenario: a naive pass adding a glob-named file does not hide a modified sibling
    Given step "seam.check" changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/calc*.ts" with:
      """
      export const subtract = (a: number, b: number) => a - b
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"reject","p":0.9}]
      """
    When the process is driven
    Then the process rests at "seam.steer"
    And the resting step's content contains "src/calc.ts"
    And the resting step's content does not contain "src/calc*.ts"

  Scenario: an edit at the steer gate runs the naive pass again with a fresh retry budget
    Given step "seam.check" changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => b + a
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"reject","p":0.9}]
      """
    When the process is driven
    Then the process rests at "seam.steer"
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Concerns

      ### Subtract

      - `subtract(a, b)` returns `a - b`, in a new module.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    When gtd lands
    Then the process rests at "seam.naive"
    And the resting step's content does not contain "was rejected"
    When the process is driven
    Then the process rests at "seam.steer"
    And the commit subjects end with:
      """
      gtd(human): seam.steer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → seam.steer
      """

  Scenario: a clean landing at the steer gate overrules, with no seam gate and no refactor
    Given step "seam.check" changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => b + a
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"reject","p":0.9}]
      """
    When the process is driven
    Then the process rests at "seam.steer"
    When gtd lands
    Then the process rests at "implement.building"
    And the commit subjects end with:
      """
      gtd(judge): seam.judge → seam.steer
      gtd(human): seam.steer → implement.building
      """
