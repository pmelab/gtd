@live
Feature: the bundled workflow's health check runs "testCommand"

  `build.health.check` prints a script that runs the `testCommand` var and,
  when it fails, leaves its output in `.gtd/FEEDBACK.md`, stamped with the
  commit it ran at. The var defaults to `npm test`; `.gtdrc` `vars:` and
  `GTD_TESTCOMMAND` override it.

  Background:
    Given a test project
    And the workflow
    And gtd starts workflow "fix"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 failing test
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"

  Scenario: the default testCommand runs the project's npm test script
    Given a file "package.json" with:
      """
      { "name": "fixture", "private": true, "scripts": { "test": "echo default-wins; exit 1" } }
      """
    And an environment variable "GTD_FASTTESTCOMMAND" set to "true"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/FEEDBACK.md" contains "default-wins"
    And ".gtd/FEEDBACK.md" contains "<!-- gtd check "

  Scenario: a GTD_TESTCOMMAND environment variable overrides the default
    Given an environment variable "GTD_TESTCOMMAND" set to "echo env-wins; exit 1"
    And an environment variable "GTD_FASTTESTCOMMAND" set to "true"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/FEEDBACK.md" contains "env-wins"

  Scenario: a green run leaves no FEEDBACK.md and lands on the quality lap
    Given an environment variable "GTD_TESTCOMMAND" set to "true"
    And an environment variable "GTD_FASTTESTCOMMAND" set to "true"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/FEEDBACK.md" does not exist
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality.correctness.reviewing"
