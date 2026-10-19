@inmem
Feature: with GTD_FLAG_RISK_TIER on, stated acceptance criteria never skip design

  The risk tier is proposed at `design.triage` and set at the design gate, so
  with the flag on a sketch that states its own criteria still runs triage and
  is never judged at `design.clear`.

  Scenario: stated criteria go through triage, where the tier is proposed and set
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_RISK_TIER" set to "1"
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And a file "TODO.md" with:
      """
      ## Acceptance criteria

      - `greeting` reads "Hello, world".
      """
    When the process is driven
    Then the process rests at "design.triage"
    And the commit subjects end with:
      """
      gtd(check): start-gate.check → design.triage
      """
