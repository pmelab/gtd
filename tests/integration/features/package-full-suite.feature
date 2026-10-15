Feature: every package leaves the full suite green, so the quality lap follows the last one

  A package's health check runs `testCommand` — the bundled workflow has no
  lighter suite. Closing the last package also removes `.gtd/ARCHITECTURE.md`,
  and the tail goes straight to `build.quality.<lens>.reviewing`: no second
  full run repeats the one that just went green.

  Background:
    Given a test project
    And the workflow gtd install scaffolds
    And an environment variable "GTD_FLAG_NAIVE_PASS" set to "0"
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → unwind"

    And the file "NOTE.md" is deleted

    And gtd lands "gtd(check): unwind → start-gate.check"
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

  @inmem
  Scenario: the package loop's health check runs testCommand
    Given an environment variable "GTD_TESTCOMMAND" set to "run-full-suite"
    And the shell command "run-full-suite" exits 1 with:
      """
      full-suite-ran
      """
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/FEEDBACK.md" contains "full-suite-ran"

  @inmem
  Scenario: closing the last package removes the architecture document
    Given gtd lands "gtd(check): packages.item.health.check → packages.item.closing"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/ARCHITECTURE.md" does not exist
    And ".gtd/packages/01-widget.md" does not exist

  @inmem
  Scenario: the last package's closing goes straight to the quality lap
    Given gtd lands "gtd(check): packages.item.health.check → packages.item.closing"
    And the file ".gtd/packages/01-widget.md" is deleted
    And the file ".gtd/ARCHITECTURE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.closing → build.quality.correctness.reviewing"
