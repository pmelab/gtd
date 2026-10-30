Feature: hand-over — a pinned process runs on its pin

  The gtd on PATH looks for `.gtd/process.gtdpin` in the worktree, or in HEAD
  when the worktree's copy is gone, and runs the command on the engine and
  workflow the pin carries, passing its exit code and signals through. `--live`
  runs this gtd instead. The commands a pin's engine lacks, or that read the
  live state, never hand over: `ui`, `lsp`, `guide`, `bundle`, `help`,
  `version` and the `history` commands. A pin whose format this gtd does not
  know is refused, never guessed at. The in-memory pin carries no engine, so
  the in-memory tier stands this engine in for it; only `@live` runs a real
  one.

  Background:
    Given a test project
    And a file "brief.ts" with:
      """
      export const brief = "build it as pinned"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"
      import { brief } from "./brief.js"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", brief)
        await agent("checking", "check it")
      }
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """

  @inmem
  Scenario: a process without a pin runs on this gtd
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--verbose"
    Then it succeeds
    And stderr does not contain "launcher: running the pin"

  @inmem
  Scenario: a pinned process hands every command over to its pin
    When I run gtd land
    And I run the pin beat
    And I run gtd next with "--verbose"
    Then it succeeds
    And stderr contains "launcher: running the pin"
    And stderr contains ".gtd/process.gtdpin (gtd in-memory)"

  @inmem
  Scenario: a pin deleted from the worktree still runs from HEAD
    When I run gtd land
    And I run the pin beat
    And the file ".gtd/process.gtdpin" is deleted
    And I run gtd next with "--verbose"
    Then it succeeds
    And stderr contains "launcher: running the pin"

  @inmem
  Scenario: --live runs this gtd instead of the pin
    When I run gtd land
    And I run the pin beat
    And I run gtd with args "--live next --verbose"
    Then it succeeds
    And stderr does not contain "launcher: running the pin"

  @inmem
  Scenario Outline: gtd <command> never hands over
    When I run gtd land
    And I run the pin beat
    And I run gtd with args "<command> --verbose"
    Then stderr does not contain "launcher: running the pin"

    Examples:
      | command      |
      | guide        |
      | bundle       |
      | history list |
      | help         |

  @inmem
  Scenario: gtd version names the pin's version too
    When I run gtd land
    And I run the pin beat
    And I run gtd with args "version"
    Then it succeeds
    And stdout contains "(this process is pinned to gtd in-memory)"

  @inmem
  Scenario: a pin in a format this gtd does not know is refused
    Given a file ".gtd/process.gtdpin" with:
      """
      gtdpin 2 gtd 99.0.0
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains ".gtd/process.gtdpin is pin format 2, made by gtd 99.0.0"
    And stderr contains "upgrade gtd"
    When I run gtd with args "--live next"
    Then it succeeds

  @inmem
  Scenario: a file that is no pin is refused
    Given a file ".gtd/process.gtdpin" with:
      """
      not a pin
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains ".gtd/process.gtdpin is no pin this gtd can read"
    When I run gtd next with "--json"
    Then the exit code is 1
    And stderr contains "{\"state\":\"error\",\"prompt\":\"gtd: "

  @live
  Scenario: editing the config mid-process does not change the next step
    When I run gtd land
    And I run the pin beat
    And a file "brief.ts" with:
      """
      export const brief = "build it as edited"
      """
    And I run gtd next with "--verbose"
    Then it succeeds
    And stderr contains "launcher: running the pin" exactly once
    And stdout contains "build it as pinned"
    And stdout does not contain "build it as edited"
    And stderr contains "the live config differs from the pinned one (brief.ts); `gtd repin` to switch"
    When I run gtd with args "--live next"
    Then it succeeds
    And stdout contains "build it as edited"

  @live
  Scenario: the pin's exit code passes through
    When I run gtd land
    And I run the pin beat
    And I run gtd with args "nonsense -v"
    Then the exit code is 2
    And stderr contains "launcher: running the pin"
    And stderr contains "unknown command"

  @live
  Scenario: the unpin landing runs on the pin from HEAD
    When I run gtd land
    And I run the pin beat
    And a file "brief.ts" with:
      """
      export const brief = "build it as edited"
      """
    And a file "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("elsewhere", "a workflow the process never ran")
      }
      """
    And I run gtd land
    And a file "checked.txt" with:
      """
      checked
      """
    And I run gtd land
    Then the last commit subject is "gtd(agent): checking → unpin"
    When I run the unpin beat
    Then it succeeds
    And the last commit subject is "gtd(check): unpin → idle"

  @live
  Scenario: a pin in a format this gtd does not know is refused
    Given a file ".gtd/process.gtdpin" with:
      """
      gtdpin 2 gtd 99.0.0
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains "upgrade gtd"

  @live
  Scenario: SIGTERM kills a pinned gtd next with status 143
    When I run gtd land
    And I run the pin beat
    And the git index has settled
    When I send SIGTERM to a spawned gtd next
    Then the reported exit status is 143
    And the child was still alive when the signal landed
