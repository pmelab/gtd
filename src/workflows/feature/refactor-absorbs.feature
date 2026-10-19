# One SDLC path per file, so a changed path reds exactly one fixture — do not merge.
@inmem
Feature: a refactor that already meets the requirements ends the process

  With GTD_FLAG_NAIVE_PASS on and GTD_FLAG_RISK_TIER off, a refactor-first
  refactor can land everything the requirements ask for. The feature slice's
  implement turn then has nothing to author: its empty turn completes the
  step, and with no code changed since the refactor the feature review is
  skipped — the refactor review already signed that code off.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_REFACTORQUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_NAIVE_PASS" set to "1"
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
      """
    And step "design.gate.answer" changes nothing

  Scenario: an empty implement turn after a refactor that did it all rests at idle
    Given step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And step "refactor.deriving" runs its script
    And step "refactor.building" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "refactor.health.check" changes nothing
    And step "refactor.closing" runs its script
    And step "refactor.build.review.reviewing" writes ".gtd/REVIEW.md" with:
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
    And step "implement.building" changes nothing
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/REQUIREMENTS.md" does not exist
    And "src/calc.ts" contains "subtract"
    And the commit subjects end with:
      """
      gtd(human): refactor.build.review.await-review → refactor.build.review.closing
      gtd(check): refactor.build.review.closing → implement.building
      gtd(agent): implement.building → implement.health.check
      gtd(check): implement.health.check → implement.closing
      gtd(check): implement.closing → idle
      """
    And the output lines of gtd "slices" start with:
      """
      refactor 
      feature 
      """
