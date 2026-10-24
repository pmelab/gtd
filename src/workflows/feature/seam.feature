@inmem
Feature: the naive pass and seam judge decide how a feature is built

  After design a naive pass is set aside under a kept ref, the judge reads its
  diff, and the process either applies the pass as the implementation,
  refactors the seam first behind a human approval, or retries the naive pass.

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

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And step "design.gate.answer" changes nothing

  Scenario: a land judgment applies the naive pass with no seam gate, refactor or build turn
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
    Then the process rests at "implement.applying"
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
      gtd(judge): seam.judge → implement.applying
      """

  Scenario: a naive pass that no longer applies is built fresh, with the implement scope's skills
    Given step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/subtract.ts" with:
      """
      export const subtract = (a: number, b: number) => a - b
      """
    And step "seam.check" writes "src/subtract.ts" with:
      """
      export const subtract = (a: number, b: number) => b - a
      """
    And step "implement.applying" runs its script
    When the process is driven
    Then the process rests at "implement.building"
    And the resting step's content contains "my-tdd, my-runbook"
    And the resting step's content contains "git show"
    And ".gtd/FEEDBACK.md" contains "could not apply the naive pass"
    And "src/subtract.ts" contains "b - a"
    And the commit subjects end with:
      """
      gtd(check): seam.check → implement.applying
      gtd(check): implement.applying → implement.building
      """

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

  Scenario: the implementation is the applied naive pass, a green check, then the requirements are closed out
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
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And "src/calc.ts" contains "subtract"
    And the commit subjects end with:
      """
      gtd(judge): seam.judge → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.closing
      gtd(check): implement.closing → build.review.reviewing
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
    Then the process rests at "implement.applying"
    And the commit subjects end with:
      """
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.applying
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

      ## Impact

      - the greeting module

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

  Scenario: a clean landing at the steer gate overrules and applies the pass, with no seam gate and no refactor
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
    Then the process rests at "implement.applying"
    And the commit subjects end with:
      """
      gtd(judge): seam.judge → seam.steer
      gtd(human): seam.steer → implement.applying
      """
