@inmem
Feature: Refusals — no-match steps commit nothing

  A flow refuses a landing it cannot explain with `refuse(message)`: the
  landing exits non-zero, the message is printed on stderr, and no commit is
  ever written for a refused step — the process stays where it rests.

  Scenario: no-match refusal names the declared patterns and commits nothing
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, refuse } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "develop the note, then write COMMIT_MSG.md with the final message")
        if (!changes("COMMIT_MSG.md").some((c) => c.status !== "deleted")) {
          refuse(
            "gtd land: no declared pattern matches the pending changes — expected A COMMIT_MSG.md or M COMMIT_MSG.md",
          )
        }
        await human("done", { message: "done" })
      }
      """
    And a file "NOTE.md" with:
      """
      Remember the milk.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"
    Given I record the commit count
    And a file "scratch.txt" with:
      """
      unrelated pending change
      """
    When I run gtd land
    Then it fails
    And stderr contains "no declared pattern matches"
    And stderr contains "A COMMIT_MSG.md"
    And stderr contains "M COMMIT_MSG.md"
    And the commit count is unchanged

  Scenario: a bare "--workflow" with no value is a usage error
    Given a test project
    And the workflow
    When I run gtd with args "--workflow"
    Then it fails
    And stderr contains "--workflow requires a value"

  Scenario: a second "--workflow" occurrence is a usage error, not last-wins
    Given a test project
    And the workflow
    When I run gtd with args "--workflow review --workflow fix"
    Then it fails
    And stderr contains "--workflow may be given at most once"

  Scenario: a duplicate "--var" name is a usage error, not last-wins
    Given a test project
    And the workflow
    When I run gtd with args "--workflow review --var reviewBase=a --var reviewBase=b"
    Then it fails
    And stderr contains "specified more than once"

  Scenario: "--var" given with no "--workflow" is a usage error
    Given a test project
    And the workflow
    When I run gtd with args "--var reviewBase=a"
    Then it fails
    And stderr contains "--var requires --workflow"

  Scenario: "--cost" combined with "--workflow" is a usage error
    Given a test project
    And the workflow
    When I run gtd with args "--workflow review --cost=5"
    Then it fails
    And stderr contains "is only valid for `gtd land`"

  Scenario: "--model" combined with "--workflow" is a usage error
    Given a test project
    And the workflow
    When I run gtd with args "--workflow review --cost=5 --model=gpt"
    Then it fails
    And stderr contains "is only valid for `gtd land`"
