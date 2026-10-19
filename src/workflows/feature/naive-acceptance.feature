@inmem
Feature: a naive pass ends only when a test names every criterion and the suite is green

  `seam.naive` writes behaviour-level acceptance tests, each naming its
  criterion's ID. `gtd land` refuses a pass whose tests leave an ID out or
  import a file the pass added; `seam.check` then runs the suite with the
  kept pass applied, and a red run sends the pass back before the judge
  sees it.

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

  Scenario: a pass whose tests leave a criterion's ID out is refused
    Given step "seam.naive" writes "tests/calc.test.ts" with:
      """
      import { add, subtract } from "../src/calc.js"
      it("[AC-1] subtracts", () => expect(subtract(5, 3)).toBe(2))
      """
    Then driving the process is refused with "acceptance-tests: no test of the naive pass names AC-2"

  Scenario: a test importing a file the pass added is refused
    Given step "seam.naive" writes "src/subtract.ts" with:
      """
      export const subtract = (a: number, b: number) => a - b
      """
    And step "seam.naive" writes "src/subtract.test.ts" with:
      """
      import { subtract } from "./subtract.js"
      it("[AC-1] subtracts", () => expect(subtract(5, 3)).toBe(2))
      it("[AC-2] still adds", () => {})
      """
    Then driving the process is refused with "src/subtract.test.ts → src/subtract.ts"

  Scenario: a red suite sends the pass back, and it moves on only once green
    Given step "seam.naive" writes "tests/calc.test.ts" with:
      """
      import { add, subtract } from "../src/calc.js"
      it("[AC-1] subtracts", () => expect(subtract(5, 3)).toBe(2))
      it("[AC-2] still adds", () => expect(add(1, 1)).toBe(2))
      """
    When the process is driven
    Then the process rests at "seam.check"
    And the resting step's content contains "git apply -R"
    And the resting step's content does not contain "'^'"
    And the resting step's content contains "npm test"

    Given step "seam.naive" is no longer scripted
    And step "seam.check" writes ".gtd/FEEDBACK.md" with:
      """
      FAIL tests/calc.test.ts > [AC-1] subtracts
      """
    When the process is driven
    Then the process rests at "seam.naive"
    And the resting step's content contains "left the suite red"
    And ".gtd/FEEDBACK.md" contains "[AC-1] subtracts"

    Given step "seam.naive" writes "tests/calc.test.ts" with:
      """
      import { add, subtract } from "../src/calc.js"
      it("[AC-1] subtracts", () => expect(subtract(5, 3)).toBe(2))
      it("[AC-2] still adds", () => expect(add(2, 2)).toBe(4))
      """
    And step "seam.check" from now on changes nothing
    When the process is driven
    Then the process rests at "implement.building"
    And the commit subjects end with:
      """
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.building
      """
