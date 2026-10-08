Feature: fastTestCommand is required — unset, the workflow rests at its check and writes .gtd/SETUP.md

  The bundled workflow's checks run the `fastTestCommand` setting (everything
  but e2e). While it is unset or blank, the printed check script writes
  `.gtd/SETUP.md` naming the setting instead of running a suite, and the
  process rests at that check until the setting is filled.

  @inmem
  Scenario: a SETUP.md at start-gate.check rests there, and removing it moves on
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And a file ".gtd/SETUP.md" with:
      """
      The bundled workflow needs the `fastTestCommand` setting.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check"
    Given the file ".gtd/SETUP.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"

  @live
  Scenario: an unset fastTestCommand makes the printed check script write SETUP.md
    Given a test project
    And the workflow
    And the environment variable "GTD_FASTTESTCOMMAND" is unset
    And gtd enters "start-gate.check"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/SETUP.md" contains "fastTestCommand"
    And ".gtd/FEEDBACK.md" does not exist

  @live
  Scenario: the package loop's health check renders fastTestCommand, not testCommand
    Given a test project
    And the workflow
    And an environment variable "GTD_FASTTESTCOMMAND" set to "echo fast-suite-ran; exit 1"
    And an environment variable "GTD_TESTCOMMAND" set to "echo full-suite-ran; exit 1"
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
    And gtd lands "gtd(human): architecture.gate.answer → architecture.decompose.decomposing"
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget.
      """
    And gtd lands "gtd(agent): architecture.decompose.decomposing → packages.item.building"
    And a file "src/widget.ts" with:
      """
      export const widget = 1
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/FEEDBACK.md" contains "fast-suite-ran"
    And ".gtd/FEEDBACK.md" does not contain "full-suite-ran"
