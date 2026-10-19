@inmem
Feature: human review is the review door's, never the feature workflow's

  A feature process ends once its last slice lands: the quality lap is its
  last look at the change, and no human review rest follows it. Human review
  runs only when someone opens the `review` door.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
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

  Scenario: a feature process ends at idle with no review rest
    When the process is driven
    Then the process rests at "idle"
    And "src/calc.ts" contains "subtract"
    And ".gtd/REVIEW.md" does not exist
    And the commit subjects end with:
      """
      gtd(human): design.gate.answer → implement.building
      gtd(agent): implement.building → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → idle
      """

  Scenario: the review door still runs human review over the finished feature
    When the process is driven
    Then the process rests at "idle"

    Given step "review-gate.check" changes nothing
    And step "build.health.check" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#2-2
        new subtract function
      """
    When gtd opens door "review" with "HEAD~9"
    And the process is driven
    Then the process rests at "build.review.await-review"
    And the resting step's content contains the hash of the commit "feat: add calculator"

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [x] ./src/calc.ts#2-2
        new subtract function
      """
    And step "build.review.closing" runs its script
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/REVIEW.md" does not exist
    And the commit subjects end with:
      """
      gtd(check): implement.closing → idle
      gtd(human): review-gate.check
      gtd(check): review-gate.check → build.health.check
      gtd(check): build.health.check → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.await-review
      gtd(human): build.review.await-review → build.review.closing
      gtd(check): build.review.closing → idle
      """
