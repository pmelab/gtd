@inmem
Feature: a naive pass ends only when its tests reach no file it added and the suite is green

  `seam.naive` needs no test at all. A pass whose test imports a file the pass
  added is sent back; `seam.check` then runs the suite with the kept pass
  applied, and a red run sends it back too, before the judge sees it. Three
  failed attempts rest at `seam.steer`.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_RISK_TIER" set to "0"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
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

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: `subtract(5, 3)` returns 2.
      - AC-2: `add` still adds.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """

  Scenario: a pass without a test goes on to the check and the judge
    Given step "seam.check" changes nothing
    When the process is driven
    Then the process rests at "seam.judge"
    And the commit subjects end with:
      """
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      """

  Scenario: a test importing a file the pass added is sent back, and an overrule runs the check and sticks
    Given step "seam.naive" writes "src/subtract.ts" with:
      """
      export const subtract = (a: number, b: number) => a - b
      """
    And step "seam.naive" writes "src/subtract.test.ts" with:
      """
      import { subtract } from "./subtract.js"
      it("subtracts", () => expect(subtract(5, 3)).toBe(2))
      """
    When the process is driven
    Then the process rests at "seam.steer"
    And the resting step's content contains "src/subtract.test.ts → src/subtract.ts"

    Given step "seam.check" changes nothing
    When gtd lands
    And the process is driven
    Then the process rests at "seam.judge"
    And the commit subjects end with:
      """
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive
      gtd(agent): seam.naive
      gtd(agent): seam.naive → seam.steer
      gtd(human): seam.steer → seam.check
      gtd(check): seam.check → seam.judge
      """

    Given judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"reject","p":0.9}]
      """
    When the process is driven
    Then the process rests at "seam.steer"
    And the resting step's content contains "rejected the last attempt"
    And the commit subjects end with:
      """
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → seam.steer
      """

  Scenario: a red suite sends the pass back, and it moves on only once green
    Given step "seam.naive" writes "tests/calc.test.ts" with:
      """
      import { add, subtract } from "../src/calc.js"
      it("subtracts", () => expect(subtract(5, 3)).toBe(2))
      it("still adds", () => expect(add(1, 1)).toBe(2))
      """
    When the process is driven
    Then the process rests at "seam.check"
    And the resting step's content contains "git checkout -q HEAD --"
    And the resting step's content does not contain "'^'"
    And the resting step's content contains "npm test"

    Given step "seam.naive" is no longer scripted
    And step "seam.check" writes ".gtd/FEEDBACK.md" with:
      """
      FAIL tests/calc.test.ts > subtracts
      """
    When the process is driven
    Then the process rests at "seam.naive"
    And the resting step's content contains "left the suite red"
    And ".gtd/FEEDBACK.md" contains "> subtracts"

    Given step "seam.naive" writes "tests/calc.test.ts" with:
      """
      import { add, subtract } from "../src/calc.js"
      it("subtracts", () => expect(subtract(5, 3)).toBe(2))
      it("still adds", () => expect(add(2, 2)).toBe(4))
      """
    And step "seam.check" from now on changes nothing
    When the process is driven
    Then the process rests at "implement.applying"
    And the commit subjects end with:
      """
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.applying
      """
