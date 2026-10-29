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

  Scenario: a duplicate "--var" name is a usage error, not last-wins
    Given a test project
    When I run gtd with args "start review --var reviewBase=a --var reviewBase=b"
    Then the exit code is 2
    And stderr contains "specified more than once"

  Scenario: "--var" outside "gtd start" is a usage error
    Given a test project
    When I run gtd with args "--var reviewBase=a"
    Then the exit code is 2
    And stderr contains "--var is only valid for `gtd start <name>`"

  Scenario: "--cost" on "gtd start" is a usage error
    Given a test project
    When I run gtd with args "start review --cost=5"
    Then the exit code is 2
    And stderr contains "is only valid for `gtd land`"

  Scenario: "--model" on "gtd start" is a usage error
    Given a test project
    When I run gtd with args "start review --cost=5 --model=gpt"
    Then the exit code is 2
    And stderr contains "is only valid for `gtd land`"
