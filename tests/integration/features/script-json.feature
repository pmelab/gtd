@inmem
Feature: --json on every command that prints a script

  `gtd start`, `gtd abandon`, `gtd restore`,
  `gtd validate` and `gtd history fetch` print a script. Under `--json` each
  prints the script document `{ schema, script }`, and `--json=script` the
  script alone — the one idiom `gtd land` and `gtd judge answer` already take.
  Their plain output is unchanged.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "develop the note")
        await agent("reviewing", "review it")
      }

      export const hotfix = workflow(
        async () => {
          await agent("patch", "Patch it.")
        },
        { doors: { patch: {} } },
      )
      """

  Scenario: gtd abandon --json prints the script document, writing nothing
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And I run gtd land
    And I record the commit count
    When I run gtd with args "abandon --json"
    Then it succeeds
    And the json field "schema" contains "1"
    And the json field "script" contains "abandoned the process resting at"
    And the commit count is unchanged

  Scenario: gtd abandon --json=script then gtd restore --json=script, each run through sh
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And I run gtd land
    And I run the pin beat
    And the file "NOTE.md" is deleted
    And I run gtd land
    When I run in the shell:
      """
      gtd abandon --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "chore: add gtd.config.ts"
    When I run in the shell:
      """
      gtd restore --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(agent): working → reviewing"

  Scenario: gtd restore --json refuses like plain restore, with the error envelope
    When I run gtd with args "restore --json"
    Then the exit code is 1
    And stdout is empty
    And stderr contains "{\"state\":\"error\",\"prompt\":\"gtd restore: no retained history to restore.\"}"

  Scenario: gtd start takes --json=script, for a workflow and for a door
    Given I record the commit count
    When I run in the shell:
      """
      gtd start hotfix --json=script | sh
      """
    Then it succeeds
    And the commit count increased by 1
    And the last commit body contains "Gtd-Workflow: hotfix"
    When I run gtd with args "abandon"
    Then it succeeds
    When I run gtd with args "start patch --json"
    Then it succeeds
    And the json field "script" contains "gtd(human): patch"

  Scenario: gtd validate --json carries an empty script where there is nothing to validate
    When I run gtd with args "validate --json"
    Then it succeeds
    And stdout is:
      """
      {"schema":1,"script":""}
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains "nothing to validate at \"idle\""

  Scenario: gtd history fetch --json=script selects the fetch script
    When I run gtd with args "history fetch upstream --json"
    Then it succeeds
    And the json field "schema" contains "1"
    And the json field "script" contains "upstream"
    When I run gtd with args "history fetch upstream --json=script"
    Then it succeeds
    And stdout contains "upstream"
    And stdout does not contain "\"schema\""

  Scenario: an unknown --json path on a script command is a usage error
    When I run gtd with args "abandon --json=nope"
    Then the exit code is 2
    And stdout is empty
    And stderr contains "unknown --json selector \"nope\""
