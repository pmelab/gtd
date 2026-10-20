# One SDLC path per file, so a changed path reds exactly one fixture — do not merge.
@inmem
Feature: a refactor that carried the whole feature still gets a quality lap over all of it

  With GTD_FLAG_RISK_TIER off, a refactor-first
  refactor can land everything the requirements ask for. The feature slice's
  implement turn then has only the naive pass's acceptance tests to carry
  over, and with no code but tests changed since the refactor the feature
  slice's quality lap covers the whole change, refactor included.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
    And an environment variable "GTD_REFACTORQUALITYREVIEWS" set to ""
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

      ## Concerns

      ### Subtract

      - `subtract(a, b)` returns `a - b`.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And step "design.gate.answer" changes nothing

  Scenario: a tests-only implement turn after a refactor that did it all reaches the quality lap and the review
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
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And step "seam.note" writes ".gtd/REFACTOR-NOTE.md" with:
      """
      Seam: the existing code the strays touch.
      """
    And step "refactor.deriving" runs its script
    And step "refactor.building" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "refactor.health.check" changes nothing
    And step "refactor.closing" runs its script
    And step "refactor.build.review.composing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-2
        subtract next to add
      """
    And step "refactor.build.review.closing" runs its script
    When the process is driven
    Then the process rests at "refactor.build.review.await-review"

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [x] ./src/calc.ts#1-2
        subtract next to add
      """
    And step "implement.building" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    When gtd lands
    And the process is driven
    Then the process rests at "build.quality.correctness.reviewing"
    And the resting step's content contains the hash of the commit "feat: add calculator"
    And ".gtd/REQUIREMENTS.md" does not exist

    Given step "build.quality.correctness.reviewing" changes nothing
    When the process is driven
    Then the process rests at "build.review.composing"
    And "src/calc.ts" contains "subtract"
    And the commit subjects end with:
      """
      gtd(human): refactor.build.review.await-review → refactor.build.review.closing
      gtd(check): refactor.build.review.closing → implement.building
      gtd(agent): implement.building → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.review.composing
      """
    And the output lines of gtd "slices" start with:
      """
      refactor 
      feature 
      """
