@inmem
Feature: Pin and unpin beats — a process commits the engine and workflow it runs on

  A process's first beat after it starts is the pin: a `script` beat whose
  script writes `gtd bundle`'s output to `.gtd/process.gtdpin`, landed as a
  commit of that file alone. Its last beat, after the flow has ended, is the
  unpin: a `script` beat removing the file, landed as the commit that closes
  the process. Both are `check` beats, never a human's, resting at `gtd:pin`
  and `gtd:unpin` — the `gtd:` prefix is reserved for gtd's own beats, so a
  workflow step may take any name outside it. The beat document marks them
  with `pin: "add"` or `pin: "remove"`. Replay steps over both, and
  flow code never sees the pin. `gtd abandon` removes the pin with the rest of
  the process; `gtd restore` brings it back.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      }

      export const hotfix = workflow(async () => {
        await agent("patching", "patch it")
      })
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """

  Scenario: the beat after an ordinary start is the pin, marked add
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"kind\":\"script\""
    And stdout contains "\"pin\":\"add\""
    And stdout contains "\"state\":\"gtd:pin\""
    And stdout contains "\"actor\":\"check\""
    And stdout contains "gtd bundle >'.gtd/process.gtdpin'"

  Scenario: the pin beat commits the pin alone, and the process rests at its step
    When I run gtd land
    And I run the pin beat
    Then it succeeds
    And the last commit subject is "gtd(check): gtd:pin → building"
    And the last commit body contains "Gtd-Pin: add"
    And the last commit body does not contain "Gtd-Step:"
    And ".gtd/process.gtdpin" exists
    When I run gtd next
    Then it succeeds
    And stderr contains "State: building"

  Scenario: a pending edit stays pending through the pin beat
    When I run gtd land
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And I run the pin beat
    Then it succeeds
    And the git status contains "src/a.ts"

  Scenario: the pin beat's landing is refused until its script has run
    When I run gtd land
    And I run gtd land
    Then the exit code is 1
    And stderr contains ".gtd/process.gtdpin is missing"

  Scenario: a started workflow pins right after its opening commit
    When I run gtd with args "start hotfix"
    Then it succeeds
    And the last commit subject is "gtd(human): patching"
    When I run the pin beat
    Then the last commit subject is "gtd(check): gtd:pin → patching"

  Scenario: the turn that ends the flow lands at the unpin, and the unpin closes the process
    When I run gtd land
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → gtd:unpin"
    When I run gtd next with "--json"
    Then stdout contains "\"pin\":\"remove\""
    And stdout contains "\"state\":\"gtd:unpin\""
    When I run the unpin beat
    Then it succeeds
    And the last commit subject is "gtd(check): gtd:unpin → idle"
    And the last commit body contains "Gtd-Pin: remove"
    And the last commit body contains "Gtd-Version:"
    And ".gtd/process.gtdpin" does not exist
    And the git status is clean
    When I run gtd next with "--json=idle"
    Then stdout is:
      """
      true
      """

  Scenario: gtd abandon removes the pin with the rest of the process; gtd restore brings it back
    When I run gtd land
    And I run the pin beat
    And I run gtd with args "abandon"
    Then it succeeds
    And ".gtd/process.gtdpin" does not exist
    And "NOTE.md" contains "Build a thing."
    Given the file "NOTE.md" is deleted
    When I run gtd with args "restore"
    Then it succeeds
    And ".gtd/process.gtdpin" exists
    When I run gtd next
    Then stderr contains "State: building"

  Scenario: a turn that deletes the pin mid-process is followed by a fresh pin beat
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
        await agent("checking", "check it")
      }
      """
    When I run gtd land
    And I run the pin beat
    And the file ".gtd/process.gtdpin" is deleted
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → checking"
    When I run the pin beat
    Then ".gtd/process.gtdpin" exists

  Scenario: a last turn that deletes the pin still closes the process at the unpin
    When I run gtd land
    And I run the pin beat
    And the file ".gtd/process.gtdpin" is deleted
    And I run gtd land
    Then the last commit subject is "gtd(agent): building → gtd:unpin"
    When I run the unpin beat
    Then it succeeds
    And the last commit subject is "gtd(check): gtd:unpin → idle"
    When I run gtd next with "--json=idle"
    Then stdout is:
      """
      true
      """

  Scenario: a workflow step may not take a name under gtd's own prefix
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("gtd:review", "go")
      }
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains "step \"gtd:review\": the \"gtd:\" prefix is reserved for gtd's own beats"

  Scenario: a workflow step may be named pin or unpin
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("pin", "pin it")
        await agent("unpin", "unpin it")
      }
      """
    When I run gtd land
    And I run the pin beat
    Then the last commit subject is "gtd(check): gtd:pin → pin"
    When I run gtd next
    Then stdout contains "pin it"
    Given a file "a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then the last commit subject is "gtd(agent): pin → unpin"
    When I run gtd next
    Then stdout contains "unpin it"
