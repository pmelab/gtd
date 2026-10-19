@inmem
Feature: a trivial change takes the same few beats at either risk tier, flag-free at low

  With GTD_FLAG_RISK_TIER on, a one-line copy fix goes
  from idle through the naive pass, the seam judge's land, implement and human
  review back to idle. Low tier walks exactly the steps high does; only the
  implementation prompt and the summary differ.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
    And an environment variable "GTD_FLAG_RISK_TIER" set to "1"
    And a file "src/greeting.ts" with:
      """
      export const greeting = "Helo, world"
      """
    And the working tree is committed as "feat: add greeting"
    And a file "TODO.md" with:
      """
      # Fix the typo

      greeting says "Helo"; make it "Hello".
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "design.gate.answer" changes nothing
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And step "build.quality.correctness.reviewing" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## greeting

      - [ ] ./src/greeting.ts#1-1
        typo fixed
      """
    And step "build.review.closing" runs its script

  Scenario Outline: a one-line fix runs idle to idle with the same beats at either tier
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Risk Tier

      <tier> — one-line copy fix

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    When the process is driven
    Then the process rests at "seam.naive"
    And the last commit subject is "gtd(human): design.gate.answer → seam.naive"

    Given step "seam.check" changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/greeting.ts" with:
      """
      export const greeting = "Hello, world"
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    When the process is driven
    Then the process rests at "implement.building"
    And the resting step's content contains "<demand>"
    And the resting step's content does not contain "<absent>"

    Given step "implement.building" writes "src/greeting.ts" with:
      """
      export const greeting = "Hello, world!"
      """
    When the process is driven
    Then the process rests at "build.review.await-review"

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## greeting

      - [x] ./src/greeting.ts#1-1
        typo fixed
      """
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And "src/greeting.ts" contains "Hello, world!"
    And the commit subjects end with:
      """
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → implement.building
      gtd(agent): implement.building → implement.health.check
      gtd(check): implement.health.check → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.await-review
      gtd(human): build.review.await-review → build.review.closing
      gtd(check): build.review.closing → idle
      """
    And the output of gtd "summary" <summary> "needs a human reviewer"

    Examples:
      | tier | demand                                             | absent              | summary          |
      | low  | Add no release flag                                | new release flag    | does not contain |
      | high | Put the new behaviour behind a new release flag    | Add no release flag | contains         |
