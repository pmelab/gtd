@inmem
Feature: flag mode off builds a feature with no release flag, seam judge or refactor

  `flagMode` is a factory option of the shipped workflows, on by default. Off,
  the project ships without feature flags: no seam judge and no refactor run,
  and the naive implementation goes straight through the health loop and the
  quality lap.

  Background:
    Given a gtd config with:
      """
      import { feature } from "@pmelab/gtd/workflows/feature"
      export { summary, steering, skills, access } from "@pmelab/gtd/workflows/feature"
      export default feature({ flagMode: false })
      """
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
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

  Scenario: flag mode off skips the seam judge and the refactor, and asks for no flag
    When the process is driven
    Then the process rests at "implement.building"
    And the resting step's content contains "the quickest way that works"
    And the resting step's content contains "Add no release flag — this project ships without release flags"
    And the resting step's content does not contain "new release flag"
    Given step "implement.building" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And step "build.quality.correctness.reviewing" changes nothing
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And "src/calc.ts" contains "subtract"
    And the commit subjects end with:
      """
      chore: initial commit
      feat: add calculator
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → implement.building
      gtd(agent): implement.building → implement.health.check
      gtd(check): implement.health.check → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.review.reviewing
      """

  Scenario: flag mode off asks for no flag on a feedback lap either
    Given step "implement.building" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And step "build.quality.correctness.reviewing" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#2-2
        new subtract function
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#2-2
        new subtract function[^why]

      [^why]:
          - H: also export multiply
      """
    And step "build.review.collecting" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Concerns

      ### Multiply

      - Export `multiply()`.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And step "build.review.collecting" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#2-2
        new subtract function[^why]

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

      - [ ] ./src/calc.ts#2-2
        new subtract function
      """
    And step "build.review.closing" runs its script
    And step "re-unwind" runs its script
    And step "implement.building" is no longer scripted
    When gtd lands
    And the process is driven
    Then the process rests at "implement.building"
    And the resting step's content contains "Add no release flag — this project ships without release flags"
    And the resting step's content does not contain "release flag the earlier lap added"
    And no commit body contains "Gtd-Kept:"
