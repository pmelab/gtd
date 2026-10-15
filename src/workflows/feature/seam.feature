@inmem
Feature: the naive pass and seam judge replace architecture behind GTD_FLAG_NAIVE_PASS

  With the flag on, after design a naive pass is set aside under a kept ref, the
  judge reads its diff, and the process either implements straight away, refactors
  the seam first behind a human approval, or retries the naive pass. With the flag
  off nothing changes: architecture and packages run as before.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_NAIVE_PASS" set to "1"
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
      """
    And step "design.gate.answer" changes nothing

  Scenario: a land judgment goes straight to the implementation with no seam gate or refactor
    Given step "seam.naive" writes "src/calc.ts" with:
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
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → implement.building
      """

  Scenario: the naive pass lands as a marker commit and its turn stays off the branch
    Given step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    When the process is driven
    Then the process rests at "seam.judge"
    And the last commit subject is "gtd(agent): seam.naive → seam.judge"
    And the last commit body contains "Gtd-Kept:"
    And "src/calc.ts" does not contain "subtract"

  Scenario: the implementation is one build turn, a green check, then the requirements are closed out
    Given step "seam.naive" writes "src/calc.ts" with:
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
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And the commit subjects end with:
      """
      gtd(judge): seam.judge → implement.building
      gtd(agent): implement.building → implement.health.check
      gtd(check): implement.health.check → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      """
    And ".gtd/REQUIREMENTS.md" does not exist

  Scenario: a naive pass modifying a test file and adding a new one skips the judge
    Given step "seam.naive" writes "src/subtract.ts" with:
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
      gtd(agent): seam.naive → implement.building
      """

  Scenario: a refactor-first judgment rests at the approval gate, then refactors, then implements
    Given step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And step "refactor.deriving" writes ".gtd/REFACTOR.md" with:
      """
      # Behaviour-neutral refactor

      ## Scope (read-only)

      - `src/calc.ts` # gtd-path-exempt: scenario fixture, not a repo file
      """
    And step "refactor.building" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const op = (a: number, b: number, sign: number) => a + sign * b
      """
    And step "refactor.health.check" changes nothing
    And step "refactor.closing" runs its script
    When the process is driven
    Then the process rests at "seam.approve"
    And the resting step's content contains "src/calc.ts"
    When gtd lands
    Then the last commit subject is "gtd(human): seam.approve → refactor.deriving"
    And the last commit body contains "Gtd-Approved:"
    When the process is driven
    Then the process rests at "implement.building"
    And the commit subjects end with:
      """
      gtd(judge): seam.judge → seam.approve
      gtd(human): seam.approve → refactor.deriving
      gtd(check): refactor.deriving → refactor.building
      gtd(agent): refactor.building → refactor.health.check
      gtd(check): refactor.health.check → refactor.closing
      gtd(check): refactor.closing → implement.building
      """

  Scenario: three rejects retry the naive pass twice, then rest at the steer gate
    Given step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => b + a
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"reject","p":0.9}]
      """
    When the process is driven
    Then the process rests at "seam.steer"
    And the resting step's content contains "Overrule"
    And the resting step's content contains "src/calc.ts"
    And the commit subjects end with:
      """
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → seam.steer
      """

  Scenario: an edit at the steer gate runs the naive pass again with a fresh retry budget
    Given step "seam.naive" writes "src/calc.ts" with:
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
      """
    When gtd lands
    Then the process rests at "seam.naive"
    And the resting step's content does not contain "was rejected"
    When the process is driven
    Then the process rests at "seam.steer"
    And the commit subjects end with:
      """
      gtd(human): seam.steer → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → seam.steer
      """

  Scenario: a clean landing at the steer gate overrules, with no seam gate and no refactor
    Given step "seam.naive" writes "src/calc.ts" with:
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

  Scenario: review feedback re-runs design and the whole seam phase
    Given step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => b + a
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    And step "implement.building" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const SUBTRACT = process.env.GTD_FLAG_SUBTRACT === "1"
      """
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        new add function
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        new add function[^why]

      [^why]:
          - H: also export multiply
      """
    And step "build.review.collecting" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Concerns

      ### Multiply

      - Export `multiply()`.
      """
    And step "build.review.collecting" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        new add function[^why]

      [^why]:
          - H: also export multiply
          - A: noted in the requirements.
      """
    When gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        new add function
      """
    And step "build.review.closing" runs its script
    And step "re-unwind" runs its script
    When gtd lands
    And the process is driven
    Then the process rests at "implement.building"
    And the commit subjects end with:
      """
      gtd(check): re-unwind → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → implement.building
      gtd(agent): implement.building
      """
