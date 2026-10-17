@inmem
Feature: gtd summary --slice — the closing-message prompt for one slice

  `gtd summary --slice <name>` prints the same prompt as `gtd summary`, scoped
  to one slice as `gtd slices` lists it: its own `base..tip` range, its own
  human commits and its own cost. The entry commit and the process marks stay
  whole-process, so a stacked PR can state its motivation cold. Plain
  `gtd summary` is unchanged.

  Scenario: each slice prints only its own range, human commits and cost, summing to the plain summary
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await human("gate", { message: "confirm before verifying" })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }

      export const summary = (it) =>
        [
          it.slice ? `slice ${it.slice.name} ${it.slice.index} of ${it.slice.count}` : "whole process",
          `Entry: ${it.entryCommit}`,
          ...it.humanCommits.map((c) => `Human: ${c.hash} entering ${c.state}`),
          `Range: ${it.processBase}..${it.processTip}`,
          `Cost: ${it.processCost}`,
        ].join("\n")
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building" with "--cost=1"
    And I mark the current commit as "entry"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → gate" with "--cost=10 --model=sonnet"
    And I mark the current commit as "built"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(human): gate → checking" with "--cost=100"
    And I mark the current commit as "gate"
    And a file "c.txt" with:
      """
      c
      """
    And gtd lands "gtd(agent): checking → idle" with "--cost=1000"
    And I mark the current commit as "closing"
    When I run gtd with args "summary --slice build"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      slice build 1 of 2
      Entry: <entry>
      Range: <boundary>..<built>
      Cost: 11
      """
    When I run gtd with args "summary --slice verify"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      slice verify 2 of 2
      Entry: <entry>
      Human: <gate> entering checking
      Range: <built>..<closing>
      Cost: 1100
      """
    When I run gtd with args "summary"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      whole process
      Entry: <entry>
      Human: <gate> entering checking
      Range: <boundary>..<closing>
      Cost: 1111
      """

  Scenario: the entry commit is named on every slice, labelled as outside the range on the later one
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await human("gate", { message: "confirm before verifying" })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }

      export { summary } from "@pmelab/gtd/workflows"
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building" with "--cost=1"
    And I mark the current commit as "entry"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → gate" with "--cost=10"
    And I mark the current commit as "built"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(human): gate → checking" with "--cost=100"
    And I mark the current commit as "gate"
    And a file "c.txt" with:
      """
      c
      """
    And gtd lands "gtd(agent): checking → idle" with "--cost=1000"
    And I mark the current commit as "closing"
    When I run gtd with args "summary --slice build"
    Then it succeeds
    And stdout contains "slice `build`, 1 of 2"
    And stdout contains the hash of "entry"
    And stdout does not contain "outside this slice's range"
    And stdout contains "git log "
    When I run gtd with args "summary --slice verify"
    Then it succeeds
    And stdout contains "slice `verify`, 2 of 2"
    And stdout contains the hash of "entry"
    And stdout contains "outside this slice's range"
    And stdout contains the hash of "gate"

  Scenario: the risk advisory prints on every slice, production signals only on the last
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, mark, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        mark("risk-tier", "high")
        mark("production-signal", "error rate")
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await human("gate", { message: "confirm before verifying" })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }

      export { summary } from "@pmelab/gtd/workflows"
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building" with "--cost=1"
    And I mark the current commit as "entry"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → gate" with "--cost=10"
    And I mark the current commit as "built"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(human): gate → checking" with "--cost=100"
    And I mark the current commit as "gate"
    And a file "c.txt" with:
      """
      c
      """
    And gtd lands "gtd(agent): checking → idle" with "--cost=1000"
    And I mark the current commit as "closing"
    When I run gtd with args "summary --slice build"
    Then it succeeds
    And stdout contains "Risk tier: high"
    And stdout does not contain "Production signals"
    And stdout does not contain "error rate"
    When I run gtd with args "summary --slice verify"
    Then it succeeds
    And stdout contains "Risk tier: high"
    And stdout contains "Production signals"
    And stdout contains "- `error rate`"

  Scenario: a custom summary export receives slice under --slice and none on plain, entryCommit and marks whole-process
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, mark, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        mark("risk-tier", "high")
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await human("gate", { message: "confirm before verifying" })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }

      export const summary = (it) =>
        [
          `has-slice=${"slice" in it}`,
          `slice=${JSON.stringify(it.slice ?? null)}`,
          `entry=${it.entryCommit}`,
          `marks=${it.marks.map((m) => `${m.name}=${m.value}`).join(",")}`,
        ].join("\n")
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building" with "--cost=1"
    And I mark the current commit as "entry"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → gate" with "--cost=10"
    And I mark the current commit as "built"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(human): gate → checking" with "--cost=100"
    And I mark the current commit as "gate"
    And a file "c.txt" with:
      """
      c
      """
    And gtd lands "gtd(agent): checking → idle" with "--cost=1000"
    And I mark the current commit as "closing"
    When I run gtd with args "summary --slice verify"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      has-slice=true
      slice={"name":"verify","base":"<built>","tip":"<closing>","index":2,"count":2}
      entry=<entry>
      marks=risk-tier=high
      """
    When I run gtd with args "summary --slice=build"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      has-slice=true
      slice={"name":"build","base":"<boundary>","tip":"<built>","index":1,"count":2}
      entry=<entry>
      marks=risk-tier=high
      """
    When I run gtd with args "summary"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      has-slice=false
      slice=null
      entry=<entry>
      marks=risk-tier=high
      """

  Scenario: a flow with no slice() call answers --slice main as 1 of 1 over the plain range
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      }

      export const summary = (it) =>
        [
          it.slice ? `slice ${it.slice.name} ${it.slice.index} of ${it.slice.count}` : "whole process",
          `Entry: ${it.entryCommit}`,
          ...it.humanCommits.map((c) => `Human: ${c.hash} entering ${c.state}`),
          `Range: ${it.processBase}..${it.processTip}`,
          `Cost: ${it.processCost}`,
        ].join("\n")
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I mark the current commit as "entry"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → idle" with "--cost=7"
    And I mark the current commit as "closing"
    When I run gtd with args "summary --slice main"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      slice main 1 of 1
      Entry: <entry>
      Range: <boundary>..<closing>
      Cost: 7
      """

  Scenario: plain gtd summary on a sliced process prints the whole-process prompt with no slice wording
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await human("gate", { message: "confirm before verifying" })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }

      export { summary } from "@pmelab/gtd/workflows"
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building" with "--cost=1"
    And I mark the current commit as "entry"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → gate" with "--cost=10"
    And I mark the current commit as "built"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(human): gate → checking" with "--cost=100"
    And I mark the current commit as "gate"
    And a file "c.txt" with:
      """
      c
      """
    And gtd lands "gtd(agent): checking → idle" with "--cost=1000"
    And I mark the current commit as "closing"
    When I run gtd with args "summary"
    Then it succeeds
    And stdout contains "Write the closing message for the process HEAD closes or sits inside"
    And stdout does not contain "of 2"
    And stdout does not contain "outside this slice's range"

  Scenario: an unknown slice name exits 1 with empty stdout, naming every valid slice in stack order
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await human("gate", { message: "confirm before verifying" })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }

      export const summary = (it) =>
        [
          it.slice ? `slice ${it.slice.name} ${it.slice.index} of ${it.slice.count}` : "whole process",
          `Entry: ${it.entryCommit}`,
          ...it.humanCommits.map((c) => `Human: ${c.hash} entering ${c.state}`),
          `Range: ${it.processBase}..${it.processTip}`,
          `Cost: ${it.processCost}`,
        ].join("\n")
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building" with "--cost=1"
    And I mark the current commit as "entry"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → gate" with "--cost=10"
    And I mark the current commit as "built"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(human): gate → checking" with "--cost=100"
    And I mark the current commit as "gate"
    And a file "c.txt" with:
      """
      c
      """
    And gtd lands "gtd(agent): checking → idle" with "--cost=1000"
    And I mark the current commit as "closing"
    When I run gtd with args "summary --slice nope"
    Then the exit code is 1
    And stdout is empty
    And stderr contains "gtd summary: refused"
    And stderr contains "no slice named \"nope\""
    And stderr contains "build, verify"

  Scenario: an unknown slice name on a process recorded by another gtd version warns before it refuses
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

      export const summary = (it) => `Range: ${it.processBase}..${it.processTip}`
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
    When I run gtd with args "summary --slice nope"
    Then the exit code is 1
    And stdout is empty
    And stderr matches "recorded by gtd 0.0.1(.|\n)*gtd summary: refused — no slice named \"nope\""

  Scenario: --slice on a fresh idle repo is refused
    Given a test project
    And the workflow gtd install scaffolds
    When I run gtd with args "summary --slice main"
    Then the exit code is 1
    And stdout is empty
    And stderr contains "gtd summary: refused — HEAD neither closes nor sits inside a process"

  Scenario: --slice on a workflow with no summary export is refused
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await human("gate", { message: "confirm before verifying" })
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
    And gtd lands "gtd(human): idle → building" with "--cost=1"
    And I mark the current commit as "entry"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → gate" with "--cost=10"
    And I mark the current commit as "built"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(human): gate → checking" with "--cost=100"
    And I mark the current commit as "gate"
    When I run gtd with args "summary --slice build"
    Then the exit code is 1
    And stdout is empty
    And stderr contains "declares no \"summary:\" template"

  Scenario: --slice at a closing HEAD whose config was edited afterwards advises revert or stash
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await human("gate", { message: "confirm before verifying" })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }

      export const summary = (it) =>
        [
          it.slice ? `slice ${it.slice.name} ${it.slice.index} of ${it.slice.count}` : "whole process",
          `Entry: ${it.entryCommit}`,
          ...it.humanCommits.map((c) => `Human: ${c.hash} entering ${c.state}`),
          `Range: ${it.processBase}..${it.processTip}`,
          `Cost: ${it.processCost}`,
        ].join("\n")
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building" with "--cost=1"
    And I mark the current commit as "entry"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → gate" with "--cost=10"
    And I mark the current commit as "built"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(human): gate → checking" with "--cost=100"
    And I mark the current commit as "gate"
    And a file "c.txt" with:
      """
      c
      """
    And gtd lands "gtd(agent): checking → idle" with "--cost=1000"
    And I mark the current commit as "closing"
    And a file "gtd.config.ts" with:
      """
      // edited after the process finished
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await human("gate", { message: "confirm before verifying" })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }

      export const summary = (it) =>
        [
          it.slice ? `slice ${it.slice.name} ${it.slice.index} of ${it.slice.count}` : "whole process",
          `Entry: ${it.entryCommit}`,
          ...it.humanCommits.map((c) => `Human: ${c.hash} entering ${c.state}`),
          `Range: ${it.processBase}..${it.processTip}`,
          `Cost: ${it.processCost}`,
        ].join("\n")
      """
    When I run gtd with args "summary --slice build"
    Then the exit code is 1
    And stdout is empty
    And stderr contains "gtd summary: refused"
    And stderr contains "revert or stash the edit"

  Scenario: --slice with no value is a usage error
    Given a test project
    And the workflow gtd install scaffolds
    When I run gtd with args "summary --slice"
    Then the exit code is 2
    And stdout is empty
    And stderr contains "--slice requires a value"

  Scenario: --slice on another command is a usage error naming gtd summary
    Given a test project
    And the workflow gtd install scaffolds
    When I run gtd with args "slices --slice build"
    Then the exit code is 2
    And stderr contains "--slice is only valid for `gtd summary`"

  Scenario: an open slice prints its prompt with tip at HEAD
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await human("gate", { message: "confirm before verifying" })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }

      export const summary = (it) =>
        [
          it.slice ? `slice ${it.slice.name} ${it.slice.index} of ${it.slice.count}` : "whole process",
          `Entry: ${it.entryCommit}`,
          ...it.humanCommits.map((c) => `Human: ${c.hash} entering ${c.state}`),
          `Range: ${it.processBase}..${it.processTip}`,
          `Cost: ${it.processCost}`,
        ].join("\n")
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building" with "--cost=1"
    And I mark the current commit as "entry"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → gate" with "--cost=10"
    And I mark the current commit as "built"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(human): gate → checking" with "--cost=100"
    And I mark the current commit as "gate"
    When I run gtd with args "summary --slice verify"
    Then it succeeds
    And stdout is, with each <name> standing for the hash of that marked commit:
      """
      slice verify 2 of 2
      Entry: <entry>
      Human: <gate> entering checking
      Range: <built>..<gate>
      Cost: 100
      """

  Scenario: --slice writes nothing
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
        })
        await human("gate", { message: "confirm before verifying" })
        await slice("verify", async () => {
          await agent("checking", "check it")
        })
      }

      export const summary = (it) =>
        [
          it.slice ? `slice ${it.slice.name} ${it.slice.index} of ${it.slice.count}` : "whole process",
          `Entry: ${it.entryCommit}`,
          ...it.humanCommits.map((c) => `Human: ${c.hash} entering ${c.state}`),
          `Range: ${it.processBase}..${it.processTip}`,
          `Cost: ${it.processCost}`,
        ].join("\n")
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building" with "--cost=1"
    And I mark the current commit as "entry"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → gate" with "--cost=10"
    And I mark the current commit as "built"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(human): gate → checking" with "--cost=100"
    And I mark the current commit as "gate"
    And a file "c.txt" with:
      """
      c
      """
    And gtd lands "gtd(agent): checking → idle" with "--cost=1000"
    And I mark the current commit as "closing"
    And the git index has settled
    And I snapshot the repository
    When I run gtd with args "summary --slice build"
    Then it succeeds
    And the repository snapshot is unchanged
