Feature: after the last package, the full run precedes the quality lap

  Once the package queue is drained, `build.health.check` runs the whole suite
  before `build.quality.<lens>.reviewing`. A red run goes to `build.fix`, whose prompt
  names `.gtd/ARCHITECTURE.md` and the package ranges; a green run sweeps
  `.gtd/ARCHITECTURE.md`.

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
    And gtd lands "gtd(check): packages.item.health.check → packages.item.closing"
    And the file ".gtd/packages/01-widget.md" is deleted
    And gtd lands "gtd(check): packages.item.closing → build.health.check"

  @inmem
  Scenario: a red full run goes to build.fix, whose prompt names the architecture and package ranges
    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 e2e scenario failed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.fix"
    When I run gtd next
    Then stdout contains ".gtd/ARCHITECTURE.md"
    And stdout contains "01-widget.md"

  @inmem
  Scenario: a green full run starts the quality lap
    Given the file ".gtd/ARCHITECTURE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality.correctness.reviewing"

  @live
  Scenario: a green full run's check script sweeps the architecture document
    Given an environment variable "GTD_FASTTESTCOMMAND" set to "true"
    And an environment variable "GTD_TESTCOMMAND" set to "true"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/ARCHITECTURE.md" does not exist
