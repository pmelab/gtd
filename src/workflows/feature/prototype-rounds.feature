@inmem
Feature: past its round cap the hands-on test rests at a person's gate

  `prototypeRounds` caps the fix turns a slice's hands-on test gets. Once they
  are spent and the report still has open items, the process rests at
  implement.prototype.open naming them; a person's fix there is tested again
  with a fresh budget.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
    And an environment variable "GTD_FLAGMODE" set to "false"
    And an environment variable "GTD_PROTOTYPEROUNDS" set to "1"
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

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: add is unchanged.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a + b
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => expect(subtract(3, 1)).toBe(2))
      it("[AC-2] adds", () => expect(add(1, 1)).toBe(2))
      """
    And step "seam.check" changes nothing
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And judge step "implement.prototype.observable" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"yes","p":0.9}]
      """
    And step "implement.closing" runs its script

  Scenario: past the round cap a person is asked, naming the open items
    Given step "implement.prototype.testing", when prompted with "Find how this project", writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: fail

      `subtract(3, 1)` printed 4. Expected 2.

      ## AC-2: pass

      Printed 2.
      """
    And step "implement.prototype.testing", when prompted with "This is a re-test", writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: fail

      Re-tested: `subtract(3, 1)` printed -2. Expected 2.

      ## AC-2: pass

      Printed 2.
      """
    And step "implement.prototype.fix.fixing" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => b - a
      """
    And step "implement.prototype.health.check" changes nothing
    When the process is driven
    Then the process rests at "implement.prototype.open"
    And the resting step's content contains "- AC-1: fail"
    And the resting step's content contains "after 1 fix round"
    And the resting step's content does not contain "AC-2"

  Scenario: a person's change at the gate is tested again
    Given step "implement.prototype.testing", when prompted with "Find how this project", writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: blocked

      `subtract` is not exported from any entry point I could run.

      ## AC-2: pass

      Printed 2.
      """
    And step "implement.prototype.open" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "implement.prototype.health.check" changes nothing
    And step "implement.prototype.testing", when prompted with "This is a re-test", writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      `subtract(3, 1)` printed 2.

      ## AC-2: pass

      Printed 2.
      """
    When the process is driven
    Then the process rests at "build.quality.correctness.reviewing"
    And the commit subjects end with:
      """
      gtd(agent): implement.prototype.testing → implement.prototype.open
      gtd(human): implement.prototype.open → implement.prototype.health.check
      gtd(check): implement.prototype.health.check → implement.prototype.testing
      gtd(agent): implement.prototype.testing → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      """

  Scenario: a re-test that sees exactly what the last round saw still ends the round
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: fail

      `subtract(3, 1)` printed 4. Expected 2.

      ## AC-2: pass

      Printed 2.
      """
    And step "implement.prototype.fix.fixing" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => b - a
      """
    And step "implement.prototype.health.check" changes nothing
    When the process is driven
    Then the process rests at "implement.prototype.open"
    And the commit subjects end with:
      """
      gtd(agent): implement.prototype.testing → implement.prototype.fix.fixing
      gtd(agent): implement.prototype.fix.fixing → implement.prototype.health.check
      gtd(check): implement.prototype.health.check → implement.prototype.testing
      gtd(agent): implement.prototype.testing → implement.prototype.open
      """
