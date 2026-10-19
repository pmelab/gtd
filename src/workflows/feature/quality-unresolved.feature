@inmem
Feature: quality findings left unresolved hold a feature process short of idle

  The quality lap is the last look `feature` takes. When the fix cap leaves
  `.gtd/QUALITY.md` behind, the process rests for a person instead of ending
  with findings nobody acted on.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
    And an environment variable "GTD_FLAGMODE" set to "false"
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

      - AC-1: subtract(a, b) returns a - b.
      """
    And step "design.gate.answer" changes nothing
    And step "implement.building" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """

  Scenario: findings the fix cap left unresolved rest at build.quality-unresolved
    Given step "build.quality.correctness.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      - subtract has no test
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
      export const subtract = (a: number, b: number) => a - b
      // checked
      """
    And step "build.health.check" changes nothing
    When gtd lands
    And the process is driven
    Then the process rests at "build.quality-unresolved"
    And ".gtd/QUALITY.md" contains "subtract has no test"

    When gtd lands
    And the process is driven
    Then the process rests at "build.quality-unresolved"

    Given a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      // checked by hand
      """
    And the file ".gtd/QUALITY.md" is deleted
    And step "build.health.check" changes nothing
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And the commit subjects end with:
      """
      gtd(check): build.health.check → build.quality-unresolved
      gtd(human): build.quality-unresolved → build.health.check
      gtd(check): build.health.check → idle
      """
