@inmem
Feature: a turn stopped at its context limit is snapshotted and continued

  A naive pass, refactor or build turn told to stop at its context limit
  writes its handoff note to `.gtd/HANDOFF.md`. That turn is the snapshot —
  the naive pass's kept tip, or the refactor's or build's own commit — and a
  continuation in a fresh conversation (`<phase>.continue.<step>`) picks up
  from it with the note and what is still open. After `continuations` (3) of
  them, or `continuationStall` (2) in a row that close nothing still open, the
  phase rests at `<phase>.oversized`.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_REFACTORQUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_RISK_TIER" set to "0"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"
    And a file "TODO.md" with:
      """
      # Add subtract and multiply
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
      - AC-2: `multiply(2, 3)` returns 6.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.check" changes nothing

  Scenario: a naive pass stopped at its context limit is continued from its kept tip with the open IDs
    Given step "seam.naive" writes "tests/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And step "seam.naive" writes ".gtd/HANDOFF.md" with:
      """
      Wrote subtract and its test; multiply was next.
      """
    When the process is driven
    Then the process rests at "seam.continue.naive"
    And the resting step's content contains "Your previous turn stopped at its context limit"
    And the resting step's content contains "Still open: AC-2."
    And the resting step's content contains "Wrote subtract and its test; multiply was next."
    And the resting step's content contains "':(top)' ':(top,exclude).gtd/HANDOFF.md' | git apply"
    And ".gtd/HANDOFF.md" does not exist
    And the output of gtd "next --json" contains "\"resume\":false"
    And the output of gtd "next --json" contains "\"memory\":\"seam.continue#"

    Given step "seam.continue.naive" writes "tests/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("[AC-2] multiplies", () => {})
      """
    When the process is driven
    Then the process rests at "implement.applying"
    And the commit subjects end with:
      """
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.continue.naive
      gtd(agent): seam.continue.naive → seam.check
      gtd(check): seam.check → implement.applying
      """

  Scenario: two continuations in a row that close nothing rest for a person
    Given step "seam.naive" writes "tests/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And step "seam.naive" writes ".gtd/HANDOFF.md" with:
      """
      Subtract is tested; multiply was next.
      """
    And step "seam.continue.naive" writes ".gtd/HANDOFF.md" with:
      """
      Still on multiply.
      """
    When the process is driven
    Then the process rests at "seam.oversized"
    And the resting step's content contains "the last 2 continuations closed nothing still open"
    And the commit subjects end with:
      """
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.continue.naive
      gtd(agent): seam.continue.naive
      gtd(agent): seam.continue.naive → seam.oversized
      """

  Scenario: a refactor stopped at its context limit is run green before its continuation
    Given step "seam.naive" writes "tests/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("[AC-2] multiplies", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      export const multiply = (a: number, b: number) => a * b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And step "seam.note" writes ".gtd/REFACTOR-NOTE.md" with:
      """
      Seam: a shared `op` in src/calc.ts.
      """
    And step "refactor.deriving" runs its script
    And step "refactor.building" writes ".gtd/HANDOFF.md" with:
      """
      Started on op; nothing changed yet.
      """
    And step "refactor.health.check" changes nothing
    When the process is driven
    Then the process rests at "refactor.continue.building"
    And the resting step's content contains "Still open: src/calc.ts."
    And the resting step's content contains "Started on op; nothing changed yet."
    And the commit subjects end with:
      """
      gtd(agent): refactor.building → refactor.health.check
      gtd(check): refactor.health.check → refactor.continue.building
      """

  Scenario: a refactor continuation that leaves the note in place stopped again
    Given step "seam.naive" writes "tests/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("[AC-2] multiplies", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And step "seam.note" writes ".gtd/REFACTOR-NOTE.md" with:
      """
      Seam: a shared `op` in src/calc.ts.
      """
    And step "refactor.deriving" runs its script
    And step "refactor.building" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => a + b
      """
    And step "refactor.building" writes ".gtd/HANDOFF.md" with:
      """
      op is in; routing add through it was next.
      """
    And step "refactor.health.check" changes nothing
    And step "refactor.continue.building" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => op(a, b, 1)
      """
    When the process is driven
    Then the process rests at "refactor.continue.building"
    And the commit subjects end with:
      """
      gtd(agent): refactor.building → refactor.health.check
      gtd(check): refactor.health.check → refactor.continue.building
      gtd(agent): refactor.continue.building → refactor.health.check
      gtd(check): refactor.health.check → refactor.continue.building
      gtd(agent): refactor.continue.building
      """

  Scenario: once a naive pass has continued, its retry runs in a fresh conversation, not as a continuation
    Given step "seam.naive" writes "tests/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And step "seam.naive" writes ".gtd/HANDOFF.md" with:
      """
      Multiply was next.
      """
    And step "seam.continue.naive" writes "tests/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("[AC-2] multiplies", () => {})
      """
    And step "seam.continue.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"reject","p":0.9}]
      """
    When the process is driven
    Then the process rests at "seam.fresh.naive"
    And the resting step's content contains "rejected"
    And the output of gtd "next --json" contains "\"resume\":false"
