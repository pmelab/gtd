@inmem
Feature: gtd slices — list the slices of the process HEAD closes or sits inside

  `gtd slices` is read-only: it replays the process under today's config and
  prints its slices, first slice first. `--json` prints the document a driver
  reads, `{schema: 1, slices: [{name, base, tip, closed}]}`; plain output is
  one `name base..tip` line per slice. Only the last slice of an underway
  process is open.

  Scenario: an underway process resting in its second slice lists two slices, the first closed
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → checking"
    And I mark the current commit as "head"
    When I run gtd with args "slices --json"
    Then it succeeds
    And stderr does not contain "warning"
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      {"schema":1,"slices":[{"name":"build","base":"<boundary>","tip":"<head>","closed":true},{"name":"verify","base":"<head>","tip":"<head>","closed":false}]}
      """

  Scenario: HEAD finishing the process closes every slice, the last ending at the closing commit
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → checking"
    And I mark the current commit as "middle"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(agent): checking → idle"
    And I mark the current commit as "closing"
    When I run gtd with args "slices --json"
    Then it succeeds
    And stderr does not contain "warning"
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      {"schema":1,"slices":[{"name":"build","base":"<boundary>","tip":"<middle>","closed":true},{"name":"verify","base":"<middle>","tip":"<closing>","closed":true}]}
      """

  Scenario: a closing commit recorded by another gtd version warns on stderr, stdout unchanged
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → checking"
    And I mark the current commit as "middle"
    And a file "b.txt" with:
      """
      b
      """
    And the working tree is committed with message:
      """
      gtd(agent): checking → idle

      Gtd-Step: checking#1
      Gtd-Version: 0.0.1
      Gtd-Format: 1
      """
    And I mark the current commit as "closing"
    When I run gtd with args "slices"
    Then it succeeds
    And stderr contains "recorded by gtd 0.0.1"
    And stderr contains the gtd version under test
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      build <boundary>..<middle>
      verify <middle>..<closing>
      """
    When I run gtd with args "slices --json"
    Then it succeeds
    And stderr contains "recorded by gtd 0.0.1"
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      {"schema":1,"slices":[{"name":"build","base":"<boundary>","tip":"<middle>","closed":true},{"name":"verify","base":"<middle>","tip":"<closing>","closed":true}]}
      """

  Scenario: a flow with no slice() call has one main slice over the whole episode
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
        await agent("checking", "check it")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I mark the current commit as "head"
    When I run gtd with args "slices --json"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      {"schema":1,"slices":[{"name":"main","base":"<boundary>","tip":"<head>","closed":false}]}
      """

  Scenario: no process underway refuses with empty stdout
    Given a test project
    And the workflow gtd install scaffolds
    When I run gtd with args "slices"
    Then the exit code is 1
    And stdout is empty
    And stderr contains "gtd slices: refused"
    And stderr contains "HEAD neither closes nor sits inside a process"

  Scenario: a finished process whose config was edited afterwards refuses, advising revert or stash
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → checking"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(agent): checking → idle"
    And a file "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      // edited after the process finished
      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }
      """
    When I run gtd with args "slices"
    Then the exit code is 1
    And stdout is empty
    And stderr contains "revert or stash the edit"
    And stderr does not contain "commit or"

  Scenario: a config-edited refusal also warns when the closing commit came from another gtd version
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → checking"
    And a file "b.txt" with:
      """
      b
      """
    And the working tree is committed with message:
      """
      gtd(agent): checking → idle

      Gtd-Step: checking#1
      Gtd-Version: 0.0.1
      Gtd-Format: 1
      """
    And a file "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      // edited after the process finished
      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }
      """
    When I run gtd with args "slices"
    Then the exit code is 1
    And stdout is empty
    And stderr contains "gtd slices: refused"
    And stderr contains "revert or stash the edit"
    And stderr contains "recorded by gtd 0.0.1"
    And stderr contains the gtd version under test

  Scenario: a non-gtd commit after a finished process refuses with empty stdout
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → idle"
    And a file "other.txt" with:
      """
      other
      """
    And the working tree is committed as "chore: unrelated"
    When I run gtd with args "slices"
    Then the exit code is 1
    And stdout is empty
    And stderr contains "gtd slices: refused"

  Scenario: plain output is one name base..tip line per slice with full hashes
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → checking"
    And I mark the current commit as "head"
    When I run gtd with args "slices"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      build <boundary>..<head>
      verify <head>..<head>
      """

  Scenario: after restart() only the current episode's slices are listed
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, restart, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("lap", async () => {
          await agent("building", "build it")
        })
        await restart()
      }
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And a file "a.txt" with:
      """
      a
      """
    And I run gtd land
    And I mark the current commit as "restarted"
    When I run gtd with args "slices"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      lap <config>..<restarted>
      """
    And a file "NOTE.md" with:
      """
      Build another thing.
      """
    And I run gtd land
    And I mark the current commit as "head"
    When I run gtd with args "slices"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      lap <restarted>..<head>
      """

  Scenario: --json=<path> selects one value, and an unknown path is a usage error
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → checking"
    And I mark the current commit as "head"
    When I run gtd with args "slices --json=slices.1.tip"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      <head>
      """
    When I run gtd with args "slices --json=schema"
    Then it succeeds
    And stdout is:
      """
      1
      """
    When I run gtd with args "slices --json=nope"
    Then the exit code is 2

  Scenario: gtd slices leaves the repository unchanged
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I snapshot the repository
    When I run gtd with args "slices"
    Then it succeeds
    And the repository snapshot is unchanged
