@inmem
Feature: CLI help and messages — point at the fix, not just the failure

  Every command has its own help, reachable as `gtd help <command>`,
  `gtd <command> --help` or `gtd <command> -h`. A usage mistake names the
  nearest thing that would have worked, and a refusal says what to do next.

  Scenario: gtd help <command> prints that command's own help
    Given a test project
    When I run gtd with args "help land"
    Then it succeeds
    And stdout contains "Usage: gtd land [options]"
    And stdout contains "--cost=<n>"
    And stdout does not contain "--port"

  Scenario: gtd <command> --help prints the same help as gtd help <command>
    Given a test project
    When I run gtd with args "judge run --help"
    Then it succeeds
    And stdout contains "Usage: gtd judge run [options]"
    And stdout contains "--provider=<name>"

  Scenario: gtd <command> -h prints that command's own help
    Given a test project
    When I run gtd with args "check -h"
    Then it succeeds
    And stdout contains "Usage: gtd check <mode> <file> [options]"
    And stdout contains "--open-questions"

  Scenario: bare gtd prints a short usage and points at gtd help
    Given a test project
    When I run gtd
    Then the exit code is 2
    And stdout is empty
    And stderr contains "Usage: gtd <command> [options]"
    And stderr contains "run `gtd help` for every command"
    And stderr does not contain "Driver plumbing:"

  Scenario: a mistyped command names the nearest one
    Given a test project
    When I run gtd with args "nxt"
    Then the exit code is 2
    And stdout is empty
    And stderr contains "gtd: unknown command 'nxt' — did you mean `gtd next`? Run `gtd help` for every command"

  Scenario: gtd help with a mistyped command names the nearest one
    Given a test project
    When I run gtd with args "help lnad"
    Then the exit code is 2
    And stderr contains "did you mean `gtd help land`?"

  Scenario: a bare --json followed by a field name suggests the = form
    Given a test project
    When I run gtd with args "next --json kind"
    Then the exit code is 2
    And stderr contains "to print one field, write --json=kind"

  Scenario: an unknown single-dash option is an unknown option
    Given a test project
    When I run gtd with args "next -j"
    Then the exit code is 2
    And stderr contains "unknown option '-j'"

  Scenario: a missing config error carries the gtd: prefix
    Given a test project
    And the file "gtd.config.ts" is deleted
    And the working tree is committed
    When I run gtd with args "next"
    Then the exit code is 1
    And stderr contains "gtd: config:"

  Scenario: plain gtd land points at a landing that fails when gtd does
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "do it")
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run plain gtd land
    Then it succeeds
    And stdout contains "s=$(gtd land --json=script) && sh -c \"$s\""

  Scenario: plain gtd next at a prompt keeps stdout the agent's input and puts the status header on stderr
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("working", "Do the work.")
      }
      """
    And the working tree is committed
    When I run gtd next
    Then it succeeds
    And stdout is:
      """
      Do the work.
      """
    And stderr contains "State: working"
    And stderr contains "Awaits: agent"

  Scenario: starting a workflow lists the paths its script commits
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const hotfix = workflow(async () => {
        await agent("patch", "Patch it.")
      })
      """
    And the working tree is committed
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd with args "start hotfix"
    Then it succeeds
    And stdout contains "# commits every change in the working tree (git add -A):"
    And stdout contains "#   A NOTE.md"

  Scenario: an unknown name with nothing startable points at the list
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }
      """
    And the working tree is committed
    When I run gtd with args "start nope"
    Then the exit code is 2
    And stderr contains "no workflow or door is named \"nope\" — run `gtd start` to list them"
