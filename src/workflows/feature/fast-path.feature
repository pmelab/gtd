@inmem
Feature: a trivial change takes the same few beats at either risk tier

  With GTD_FLAG_RISK_TIER on, a one-line copy fix goes
  from idle through the naive pass, the seam judge's land, the applied pass and
  the quality lap to the review gate. Low tier walks exactly the steps high does; only
  the summary differs.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_PROTOTYPEROUNDS" set to "0"
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
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    And step "build.quality.correctness.reviewing" changes nothing

  Scenario Outline: a one-line fix runs from idle to the review gate with the same beats at either tier
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
    And step "implement.applying" runs its script
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And "src/greeting.ts" contains "Hello, world"
    And the commit subjects end with:
      """
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.review.reviewing
      """
    And the output of gtd "summary" <summary> "needs a human reviewer"

    Examples:
      | tier | summary          |
      | low  | does not contain |
      | high | contains         |
