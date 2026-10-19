@inmem
Feature: a process keeps the risk tier setting it started with when GTD_FLAG_RISK_TIER changes

  The flag is recorded in the opening commit, so flipping it mid-process never
  changes whether the process asks for and records a risk tier.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
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

      ## Risk Tier

      low — a new pure function
      """

  Scenario: a process started with the flag off records no tier after the flag turns on
    Given the ambient environment variable "GTD_FLAG_RISK_TIER" is "0"
    When the process is driven
    Then the process rests at "design.gate.answer"
    Given the ambient environment variable "GTD_FLAG_RISK_TIER" is "1"
    And step "design.gate.answer" changes nothing
    When the process is driven
    Then the process rests at "seam.naive"
    And the commit "gtd(human): idle → unwind" has a body containing "Gtd-Var: flag_risk_tier=0"
    And no commit body contains "Gtd-Mark:"

  Scenario: a process started with the flag on records its tier after the flag turns off
    Given the ambient environment variable "GTD_FLAG_RISK_TIER" is "1"
    When the process is driven
    Then the process rests at "design.gate.answer"
    Given the ambient environment variable "GTD_FLAG_RISK_TIER" is "0"
    And step "design.gate.answer" changes nothing
    When the process is driven
    Then the process rests at "seam.naive"
    And the commit "gtd(human): idle → unwind" has a body containing "Gtd-Var: flag_risk_tier=1"
    And the last commit body contains "Gtd-Mark: risk-tier=low"
