@inmem
Feature: quality findings left unresolved between slices hold the next slice back

  Between slices no review reads the quality lap's leftovers, so when the fix
  cap leaves `.gtd/QUALITY.md` behind the process rests for a person before
  the next slice. The last slice's leftovers become review notes instead (see
  `lens-review.feature`).

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
    And an environment variable "GTD_FLAGMODE" set to "false"
    And an environment variable "GTD_SLICEMAXCRITERIA" set to "1"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"
    And a file "TODO.md" with:
      """
      # More arithmetic

      subtract and multiply.
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: multiply(a, b) returns a * b.
      """
    And step "design.gate.answer" changes nothing
    And step "design.slicing" writes ".gtd/SLICES.md" with:
      """
      # Slices

      ## Subtract

      - AC-1

      ## Multiply

      - AC-2
      """
    And step "seam.naive", when prompted with "This slice builds AC-1 only", writes "src/sub.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And step "seam.naive", when prompted with "This slice builds AC-2 only", writes "src/mul.test.ts" with:
      """
      it("[AC-2] multiplies", () => {})
      """
    And step "seam.check" changes nothing
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And judge step "implement.coverage", when its questions contain "AC-1", answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    And judge step "implement.coverage", when its questions contain "AC-2", answers:
      """
      [{"id":"AC-2","answer":"yes","p":0.9}]
      """

  Scenario: findings the fix cap left after a slice rest at build.quality-unresolved
    Given step "build.quality.correctness.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## subtract has no negative test

      Add a test subtracting a larger number.
      """
    And step "build.fix.quality.fixing" from now on changes nothing
    And step "build.health.describe" writes ".gtd/ESCALATION.md" with:
      """
      # Escalation

      The fix turn changed nothing.
      """
    When the process is driven
    Then the process rests at "build.health.stop"
    Given step "build.fix" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      // checked
      """
    And step "build.health.check" changes nothing
    When gtd lands
    And the process is driven
    Then the process rests at "build.quality-unresolved"
    And ".gtd/QUALITY.md" contains "subtract has no negative test"

    When gtd lands
    And the process is driven
    Then the process rests at "build.quality-unresolved"

    Given the file ".gtd/QUALITY.md" is deleted
    And step "build.quality.correctness.reviewing" from now on changes nothing
    And step "build.review.composing" runs its script
    When gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And the commit subjects end with:
      """
      gtd(human): build.quality-unresolved → build.health.check
      gtd(check): build.health.check → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.review.composing
      gtd(check): build.review.composing → build.review.await-review
      """
