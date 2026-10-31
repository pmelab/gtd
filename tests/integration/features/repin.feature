Feature: gtd repin — switch a running process to the live engine and workflow

  A pinned process ignores edits to its workflow until `gtd repin` brings the
  pin beat back: its script writes `gtd bundle`'s output, from the live engine
  and config, to `.gtd/process.gtdpin`, and commits that file alone as
  `gtd(check): gtd:pin → <step>` with a `Gtd-Pin: add` trailer. Replay steps over
  it like any pin commit, so the process rests where it was, on the new pin.

  When the live workflow no longer replays the process, the repin continues
  from the divergence instead: its commit carries a `Gtd-Anchor` naming the
  last commit replay could read and names the step the live workflow reached
  there. The commits after the anchored one stay as files only, and the
  process rests at that step on HEAD's tree — or, when the live flow ends
  there, at the unpin beat.

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
    And the last commit subject is "gtd(check): gtd:pin → building"
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
    Then the last commit subject is "gtd(agent): checking → gtd:unpin"
    When I run gtd with args "repin"
    Then the exit code is 1
    And stderr contains "gtd repin: the flow has ended"

  @inmem
  Scenario: a repin that fits records no anchor
    When I run gtd land
    And I run the pin beat
    And I run gtd with args "repin"
    Then it succeeds
    And the last commit subject is "gtd(check): gtd:pin → building"
    And the last commit body does not contain "Gtd-Anchor"

  @inmem
  Scenario: a different next step — the repin continues from the last commit that replays
    When I run gtd land
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And I run gtd land
    Then the last commit subject is "gtd(agent): building → checking"
    When a file "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("constructing", "build it differently")
        await agent("checking", "check it")
      }
      """
    And I run gtd with args "--live next"
    Then the exit code is 1
    And stderr contains "run `gtd repin` to continue under it from there, or `gtd abandon` to start over"
    When I run gtd with args "repin"
    Then it succeeds
    And the last commit subject is "gtd(check): gtd:pin → constructing"
    And the last commit body contains "Gtd-Anchor: "
    And the process rests at "constructing"
    And "src/a.ts" exists
    When I run gtd next
    Then it succeeds
    And stdout contains "build it differently"
    When a file "src/b.ts" with:
      """
      export const b = 1
      """
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): constructing → checking"

  @inmem
  Scenario: a commit recording another step — a renamed first step is redone from the opening
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
      }

      export const fix = workflow(async () => {
        await agent("triage", "triage it")
        await agent("patch", "patch it")
      })
      """
    And the working tree is committed
    When I run gtd with args "start fix"
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And I run gtd land
    Then the last commit subject is "gtd(agent): triage → patch"
    When a file "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
      }

      export const fix = workflow(async () => {
        await agent("assess", "assess it")
        await agent("patch", "patch it")
      })
      """
    And I run gtd with args "repin"
    Then it succeeds
    And the last commit subject is "gtd(check): gtd:pin → assess"
    And the last commit body contains "Gtd-Anchor: "
    And the process rests at "assess"
    And "src/a.ts" exists

  @inmem
  Scenario: a missing approval — the gate that now approves is asked again
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
        await human("gate", { message: "look at it" })
        await agent("checking", "check it")
      }
      """
    When I run gtd land
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And I run gtd land
    And a file "src/a.ts" with:
      """
      export const a = 2
      """
    And I run gtd land
    Then the last commit subject is "gtd(human): gate → checking"
    When a file "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
        await human("gate", { message: "look at it", approve: true })
        await agent("checking", "check it")
      }
      """
    And I run gtd with args "repin"
    Then it succeeds
    And the last commit subject is "gtd(check): gtd:pin → gate"
    And the process rests at "gate"
    And the file "src/a.ts" contains "a = 2"
    When I run gtd next
    Then it succeeds
    And stdout contains "look at it"

  @inmem
  Scenario: a flow that now ends earlier — the anchor closes the process
    When I run gtd land
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And I run gtd land
    And a file "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
      }
      """
    And I run gtd with args "repin"
    Then it succeeds
    And the last commit subject is "gtd(check): gtd:pin → gtd:unpin"
    And the last commit body contains "Gtd-Anchor: "
    When I run gtd next with "--json"
    Then stdout contains "\"state\":\"gtd:unpin\""
    When I run the unpin beat
    Then it succeeds
    And the last commit subject is "gtd(check): gtd:unpin → idle"

  @inmem
  Scenario: a second repin on top of an anchor
    When I run gtd land
    And I run the pin beat
    And a file "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("constructing", "build it differently")
        await agent("checking", "check it")
      }
      """
    And I run gtd with args "repin"
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And I run gtd land
    Then the last commit subject is "gtd(agent): constructing → checking"
    When a file "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("constructing", "build it differently")
        await agent("verifying", "verify it")
      }
      """
    And I run gtd with args "repin"
    Then it succeeds
    And the last commit subject is "gtd(check): gtd:pin → verifying"
    And the last commit body contains "Gtd-Anchor: "
    And the process rests at "verifying"
    When a file "src/b.ts" with:
      """
      export const b = 1
      """
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): verifying → gtd:unpin"

  @inmem
  Scenario: a repin never continues at the default workflow's first step
    When I run gtd land
    And I run the pin beat
    And a file "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("waiting", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      }
      """
    And I run gtd with args "repin"
    Then the exit code is 1
    And stderr contains "the default workflow's first step"
    And the last commit subject is "gtd(check): gtd:pin → building"

  @inmem
  Scenario: without a pin, a divergence still points at gtd abandon alone
    When I run gtd land
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
    And stderr contains "the workflow changed under this process; run `gtd abandon` to start over"
    And stderr does not contain "gtd repin` to continue"
    And the last commit subject is "gtd(human): idle → building"

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
