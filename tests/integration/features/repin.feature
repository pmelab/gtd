Feature: gtd repin — switch a running process to the live engine and workflow

  A pinned process ignores edits to its workflow until `gtd repin` brings the
  pin beat back: its script writes `gtd bundle`'s output, from the live engine
  and config, to `.gtd/process.gtdpin`, and commits that file alone as
  `gtd(check): pin → <step>` with a `Gtd-Pin: add` trailer. Replay steps over
  it like any pin commit, so the process rests where it was, on the new pin.
  `repin` itself always runs live, and refuses before writing anything when
  the live workflow does not replay the process.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it with the bug")
        await agent("checking", "check it")
      }
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """

  @inmem
  Scenario: a workflow fixed mid-process takes over after a repin
    When I run gtd land
    And I run the pin beat
    And a file "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it, fixed")
        await agent("checking", "check it")
      }
      """
    And I run gtd with args "repin"
    Then it succeeds
    And the last commit subject is "gtd(check): pin → building"
    And the last commit body contains "Gtd-Pin: add"
    And the git status contains "gtd.config.ts"
    When I run gtd next
    Then it succeeds
    And stderr contains "State: building"
    And stdout contains "build it, fixed"
    When a file "src/a.ts" with:
      """
      export const a = 1
      """
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → checking"

  @inmem
  Scenario: with no process underway there is nothing to repin
    Given the file "NOTE.md" is deleted
    When I run gtd with args "repin"
    Then the exit code is 1
    And stderr contains "gtd repin: no gtd process is underway"

  @inmem
  Scenario: at the pin beat, the pin beat itself is the way to pin
    When I run gtd land
    And I run gtd with args "repin"
    Then the exit code is 1
    And stderr contains "gtd repin: the next beat pins the process already"
    And ".gtd/process.gtdpin" does not exist

  @inmem
  Scenario: once the flow has ended, only the unpin beat is left
    When I run gtd land
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And I run gtd land
    And a file "src/b.ts" with:
      """
      export const b = 1
      """
    And I run gtd land
    Then the last commit subject is "gtd(agent): checking → unpin"
    When I run gtd with args "repin"
    Then the exit code is 1
    And stderr contains "gtd repin: the flow has ended"

  @inmem
  Scenario: a live workflow that does not replay the process is refused before anything is pinned
    When I run gtd land
    And I run the pin beat
    And a file "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("constructing", "build it differently")
      }
      """
    And I run gtd with args "repin"
    Then the exit code is 1
    And stderr contains "the workflow changed under this process"
    And the last commit subject is "gtd(check): pin → building"

  @live
  Scenario: the pinned engine ignores an edit until the repin
    When I run gtd land
    And I run the pin beat
    And a file "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it, fixed")
        await agent("checking", "check it")
      }
      """
    And I run gtd next
    Then stdout contains "build it with the bug"
    And stderr contains "`gtd repin` to switch"
    When I run gtd with args "repin"
    Then it succeeds
    When I run gtd next
    Then it succeeds
    And stdout contains "build it, fixed"
    And stderr does not contain "`gtd repin` to switch"
