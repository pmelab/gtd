@inmem
Feature: the review flags an existing scenario that lost an assertion

  Scenario wording is not frozen while a workflow builds: the human
  signs the scenarios off once, in the review. A `Then` line (or an `And`/`But`
  continuing one) that a `.feature` file existing at the review's base no
  longer carries is listed in the reviewer's prompt, to be marked `Weakened:`.
  A reworded `Given` or `When` is not.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { start } from "@pmelab/gtd/flows"
      import { baseline, buildTail } from "@pmelab/gtd/workflows"

      export { feature as default, defaults, envDefaults, steering, skills, access } from "@pmelab/gtd/workflows"

      // fix as feature's own tail, whose review lists removed assertions.
      export async function fix() {
        if (await baseline("fix-precheck")) return
        await buildTail(true, start())
      }
      """
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And a commit "test: widget scenario" that adds "spec/widget.feature" with:
      """
      Feature: Widget
        Scenario: shown
          Given a widget
          When it renders
          Then it is shown
          And it is blue
      """
    And gtd starts workflow "fix"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"

  Scenario: a reworded Then is named for a Weakened: note
    Given "spec/widget.feature" is modified to:
      """
      Feature: Widget
        Scenario: shown
          Given a widget
          When it renders
          Then it is displayed
          And it is blue
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And the file ".gtd/FEEDBACK.md" is deleted
    And gtd lands "gtd(check): build.health.check → build.review.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "spec/widget.feature: Then it is shown"
    And stdout contains "`Weakened:`"
    And stdout does not contain "And it is blue"

  Scenario: a reworded Given asks for no Weakened: note
    Given "spec/widget.feature" is modified to:
      """
      Feature: Widget
        Scenario: shown
          Given a fresh widget
          When it renders
          Then it is shown
          And it is blue
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And the file ".gtd/FEEDBACK.md" is deleted
    And gtd lands "gtd(check): build.health.check → build.review.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "## Scenarios"
    And stdout does not contain "Weakened:"
