@inmem
Feature: a criterion tagged (no hands-on) is proven by its test alone

  Design may tag a criterion no person can try by using the change — prompt
  wording, internal wiring — by writing `(no hands-on)` between its ID and the
  colon. implement.prototype.testing skips it and expects no chunk for it, and
  a slice whose every criterion is tagged is not tested by hand at all. The
  coverage judge still asks for a test of every tagged criterion.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAGMODE" set to "false"
    And an environment variable "GTD_SLICEMAXCRITERIA" set to "2"
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
    And step "design.gate.answer" changes nothing
    And step "seam.check" changes nothing
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script

  Scenario: the testing turn skips a tagged criterion and needs no chunk for it
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2 (no hands-on): the build prompt names subtract.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("[AC-2] names subtract", () => {})
      """
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"yes","p":0.9}]
      """
    And step "implement.prototype.testing" is prompted with "Skip AC-2: tagged `(no hands-on)`"
    And step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.
      """
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And the commit subjects end with:
      """
      gtd(judge): implement.coverage → implement.prototype.testing
      gtd(agent): implement.prototype.testing → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      """

  Scenario: a tagged criterion without a test is still sent back for one
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1 (no hands-on): the build prompt names subtract.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] names subtract", () => {})
      """
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"no","p":0.9}]
      """
    When the process is driven
    Then the process rests at "implement.covering"

  Scenario: a change whose every criterion is tagged is not tested by hand
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1 (no hands-on): the build prompt names subtract.
      - AC-2 (no hands-on): the review prompt names subtract.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] names subtract in the build", () => {})
      it("[AC-2] names subtract in the review", () => {})
      """
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"yes","p":0.9}]
      """
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And the commit subjects end with:
      """
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      """

  Scenario: only the slice whose every criterion is tagged skips the hands-on test
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2 (no hands-on): the build prompt names subtract.
      - AC-3 (no hands-on): the review prompt names subtract.
      """
    And step "design.slicing" writes ".gtd/SLICES.md" with:
      """
      # Slices

      ## Prompts

      - AC-2
      - AC-3

      ## Subtract

      - AC-1
      """
    And step "seam.naive", when prompted with "This slice builds AC-2, AC-3 only", writes "src/prompts.test.ts" with:
      """
      it("[AC-2] names subtract in the build", () => {})
      it("[AC-3] names subtract in the review", () => {})
      """
    And step "seam.naive", when prompted with "This slice builds AC-1 only", writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And judge step "implement.coverage", when its questions contain "AC-3", answers:
      """
      [{"id":"AC-2","answer":"yes","p":0.9},{"id":"AC-3","answer":"yes","p":0.9}]
      """
    And judge step "implement.coverage", when its questions contain "AC-1", answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    And step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.
      """
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And the commit subjects end with:
      """
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.prototype.testing
      gtd(agent): implement.prototype.testing → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      """

  Scenario: the tag is frozen once design is settled
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"no","p":0.9}]
      """
    And step "implement.covering" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1 (no hands-on): subtract(a, b) returns a - b.
      """
    Then driving the process is refused with "criteria-frozen"
