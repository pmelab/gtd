@inmem
Feature: a later package that rewords a frozen e2e scenario stops at the wording gate

  Package 0 writes the e2e scenarios; their step wording is frozen once it is
  closed out. A later package that edits a frozen `.feature` step line rests at
  `packages.item.scenario-wording`. Landing clean accepts the new wording and
  continues; restoring the original rejects it and continues against it.

  Background:
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Add a widget. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture.author"
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan for the widget. No open questions.
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    And gtd lands "gtd(human): architecture.gate.answer → architecture.decompose"
    And a file ".gtd/packages/00-e2e-scenarios.md" with:
      """
      Package 0: write the widget scenario.
      """
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget.
      """
    And gtd lands "gtd(agent): architecture.decompose → packages.item.building"
    And a file "spec/widget.feature" with:
      """
      Feature: Widget
        Scenario: shown
          Given a widget
          Then it is shown
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.closing"
    And the file ".gtd/packages/00-e2e-scenarios.md" is deleted
    And gtd lands "gtd(check): packages.item.closing → packages.item.building"
    And "spec/widget.feature" is modified to:
      """
      Feature: Widget
        Scenario: shown
          Given a widget
          Then it is displayed
      """

  Scenario: accepting the reworded step continues
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building → packages.item.scenario-wording"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): packages.item.scenario-wording → packages.item.health.check"

  Scenario: rejecting the reworded step restores the original and continues
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building → packages.item.scenario-wording"
    Given "spec/widget.feature" is modified to:
      """
      Feature: Widget
        Scenario: shown
          Given a widget
          Then it is shown
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): packages.item.scenario-wording → packages.item.health.check"
