@inmem
Feature: a change with more criteria than the cap is built in coarse slices

  After design, criteria within sliceMaxCriteria are one slice, built as
  before. Above it design.slicing groups them in .gtd/SLICES.md, at most the
  cap per slice, and each slice runs in order — naive pass, implement, quality
  lap — from where the previous one landed, as slices feature-1, feature-2, …

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
      # More arithmetic

      subtract, multiply and divide.
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "design.gate.answer" changes nothing
    And step "seam.check" changes nothing
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script

  Scenario: criteria within the cap are one unnumbered slice with no slicing turn
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: multiply(a, b) returns a * b.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("[AC-2] multiplies", () => {})
      """
    And step "seam.naive" is prompted with "Read `.gtd/REQUIREMENTS.md`"
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"yes","p":0.9}]
      """
    When the process is driven
    Then the process rests at "build.review.composing"
    And the commit subjects end with:
      """
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.review.composing
      """
    And the output lines of gtd "slices" start with:
      """
      feature
      """
    And the output of gtd "slices" does not contain "feature-"
    And no commit body contains "This slice builds"

  Scenario: criteria above the cap are sliced and built slice by slice
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: multiply(a, b) returns a * b.
      - AC-3: divide(a, b) returns a / b.
      """
    And step "design.slicing" is prompted with "at most 2 per slice"
    And step "design.slicing" writes ".gtd/SLICES.md" with:
      """
      # Slices

      ## Subtract and divide

      - AC-1
      - AC-3

      ## Multiply

      - AC-2
      """
    And step "seam.naive", when prompted with "This slice builds AC-1, AC-3 only", writes "src/sub.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("[AC-3] divides", () => {})
      """
    And step "seam.naive", when prompted with "This slice builds AC-2 only", writes "src/mul.test.ts" with:
      """
      it("[AC-2] multiplies", () => {})
      """
    And judge step "implement.coverage", when its questions contain "AC-3", answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-3","answer":"yes","p":0.9}]
      """
    And judge step "implement.coverage", when its questions contain "AC-2", answers:
      """
      [{"id":"AC-2","answer":"yes","p":0.9}]
      """
    When the process is driven
    Then the process rests at "build.review.composing"
    And the commit subjects end with:
      """
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → design.slicing
      gtd(agent): design.slicing → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.review.composing
      """
    And the output lines of gtd "slices" start with:
      """
      feature-1
      feature-2
      """
    And slice "feature-2" begins where slice "feature-1" ends
    And "src/sub.test.ts" contains "[AC-3] divides"
    And "src/mul.test.ts" contains "[AC-2] multiplies"
    And ".gtd/REQUIREMENTS.md" does not exist
    And ".gtd/SLICES.md" does not exist

  Scenario: a slice over the cap is refused
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: multiply(a, b) returns a * b.
      - AC-3: divide(a, b) returns a / b.
      """
    And step "design.slicing" writes ".gtd/SLICES.md" with:
      """
      # Slices

      ## Everything

      - AC-1
      - AC-2
      - AC-3
      """
    Then driving the process is refused with "more than 2 criteria in: Everything"

  Scenario: a criterion in no slice is refused
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: multiply(a, b) returns a * b.
      - AC-3: divide(a, b) returns a / b.
      """
    And step "design.slicing" writes ".gtd/SLICES.md" with:
      """
      # Slices

      ## Subtract

      - AC-1

      ## Multiply

      - AC-2
      """
    Then driving the process is refused with "no slice for: AC-3"

  Scenario: a slicing turn may not change the acceptance criteria
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: multiply(a, b) returns a * b.
      - AC-3: divide(a, b) returns a / b.
      """
    And step "design.slicing" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: multiply(a, b) returns a * b.
      """
    And step "design.slicing" writes ".gtd/SLICES.md" with:
      """
      # Slices

      ## Subtract

      - AC-1

      ## Multiply

      - AC-2
      """
    Then driving the process is refused with "wrote outside its write access"

  Scenario: a steer that empties the last slice still ends at the review of the whole change
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: multiply(a, b) returns a * b.
      - AC-3: divide(a, b) returns a / b.
      """
    And step "design.slicing" writes ".gtd/SLICES.md" with:
      """
      # Slices

      ## Subtract and divide

      - AC-1
      - AC-3

      ## Multiply

      - AC-2
      """
    And step "seam.naive" writes "src/sub.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    When the process is driven
    Then the process rests at "seam.steer"
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      """
    When gtd lands
    And the process is driven
    Then the process rests at "build.review.composing"
    And the commit subjects end with:
      """
      gtd(human): seam.steer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.review.composing
      """
    And ".gtd/REQUIREMENTS.md" does not exist
    And ".gtd/SLICES.md" does not exist
    And the output of gtd "slices" does not contain "feature-2"
