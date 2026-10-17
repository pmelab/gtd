@inmem
Feature: slices — slice() marks a span of the flow and refuses misuse

  `slice(name, fn)` marks the span `fn` covers as one named slice. Misuse fails
  the landing with a message naming the slice, and nothing lands.

  Scenario: slice() inside slice() is refused naming both slices
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("outer", async () => {
          await slice("inner", async () => {
            await agent("building", "build it")
          })
        })
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And I record the commit count
    When I run gtd land
    Then it fails
    And stderr contains "slice \"inner\" is entered inside slice \"outer\""
    And the commit count is unchanged

  Scenario: slice() inside scope() inside slice() is refused the same way
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, scope, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("outer", async () => {
          await scope("build", async () => {
            await slice("inner", async () => {
              await agent("building", "build it")
            })
          })
        })
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And I record the commit count
    When I run gtd land
    Then it fails
    And stderr contains "slice \"inner\" is entered inside slice \"outer\""
    And the commit count is unchanged

  Scenario: two sequential slice() calls with one name are refused
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("again", async () => {})
        await slice("again", async () => {})
        await agent("building", "build it")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And I record the commit count
    When I run gtd land
    Then it fails
    And stderr contains "slice \"again\" is entered twice in this episode"
    And the commit count is unchanged

  Scenario: a loop re-entering one slice() call site is refused
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        for (let i = 0; i < 2; i++) {
          await slice("lap", async () => {})
        }
        await agent("building", "build it")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And I record the commit count
    When I run gtd land
    Then it fails
    And stderr contains "slice \"lap\" is entered twice in this episode"
    And the commit count is unchanged

  Scenario: slice("main") is refused as the reserved name
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("main", async () => {
          await agent("building", "build it")
        })
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And I record the commit count
    When I run gtd land
    Then it fails
    And stderr contains "slice \"main\" is reserved for the implicit slice"
    And the commit count is unchanged

  Scenario: a slice name outside the rule is refused naming the rule
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("Refactor", async () => {
          await agent("building", "build it")
        })
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And I record the commit count
    When I run gtd land
    Then it fails
    And stderr contains "slice \"Refactor\""
    And stderr contains "/^[a-z][a-z0-9-]*$/"
    And the commit count is unchanged

  Scenario: two slices each list exactly their own commits, the second starting where the first ends
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("build", async () => {
          await agent("building", "build it")
          await agent("testing", "test it")
        })
        await slice("verify", async () => {
          await agent("checking", "check it")
          await agent("reviewing", "review it")
        })
      }
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): building → testing"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(agent): testing → checking"
    And a file "c.txt" with:
      """
      c
      """
    And gtd lands "gtd(agent): checking → reviewing"
    Then the slices are:
      """
      build (closed)
        gtd(human): idle → building
        gtd(agent): building → testing
        gtd(agent): testing → checking
      verify (open)
        gtd(agent): checking → reviewing
      """

  Scenario: commits before the first slice, the opening commit included, belong to the first
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("prep", "prepare")
        await slice("build", async () => {
          await agent("building", "build it")
          await agent("testing", "test it")
        })
      }
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → prep"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): prep → building"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(agent): building → testing"
    Then the slices are:
      """
      build (open)
        gtd(human): idle → prep
        gtd(agent): prep → building
        gtd(agent): building → testing
      """

  Scenario: commits between two slices belong to the second
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("first", async () => {
          await agent("one", "one")
          await agent("two", "two")
        })
        await agent("gap", "between")
        await slice("second", async () => {
          await agent("three", "three")
          await agent("four", "four")
        })
      }
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → one"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): one → two"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(agent): two → gap"
    And a file "c.txt" with:
      """
      c
      """
    And gtd lands "gtd(agent): gap → three"
    And a file "d.txt" with:
      """
      d
      """
    And gtd lands "gtd(agent): three → four"
    Then the slices are:
      """
      first (closed)
        gtd(human): idle → one
        gtd(agent): one → two
        gtd(agent): two → gap
      second (open)
        gtd(agent): gap → three
        gtd(agent): three → four
      """

  Scenario: commits after the last slice belong to the last
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("only", async () => {
          await agent("one", "one")
          await agent("two", "two")
        })
        await agent("after", "after")
        await agent("wrap", "wrap")
      }
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → one"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): one → two"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(agent): two → after"
    And a file "c.txt" with:
      """
      c
      """
    And gtd lands "gtd(agent): after → wrap"
    Then the slices are:
      """
      only (open)
        gtd(human): idle → one
        gtd(agent): one → two
        gtd(agent): two → after
        gtd(agent): after → wrap
      """

  Scenario: a flow with no slice call has one main slice over the whole episode
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
    Then the slices are:
      """
      main (open)
        gtd(human): idle → building
        gtd(agent): building → checking
      """

  Scenario: a closed slice that landed no commit is not listed, and the gap commits fold into the next slice
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("first", async () => {
          await agent("one", "one")
          await agent("two", "two")
        })
        await agent("gap", "between")
        await slice("empty", async () => undefined)
        await slice("last", async () => {
          await agent("three", "three")
          await agent("four", "four")
        })
      }
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → one"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): one → two"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(agent): two → gap"
    And a file "c.txt" with:
      """
      c
      """
    And gtd lands "gtd(agent): gap → three"
    And a file "d.txt" with:
      """
      d
      """
    And gtd lands "gtd(agent): three → four"
    Then the slices are:
      """
      first (closed)
        gtd(human): idle → one
        gtd(agent): one → two
        gtd(agent): two → gap
      last (open)
        gtd(agent): gap → three
        gtd(agent): three → four
      """

  Scenario: a flow whose every slice landed nothing has one main slice over the whole episode
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("first", async () => undefined)
        await agent("building", "build it")
        await slice("second", async () => undefined)
        await agent("checking", "check it")
      }
      """
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
    Then the slices are:
      """
      main (open)
        gtd(human): idle → building
        gtd(agent): building → checking
      """

  Scenario: resting inside a slice lists it open, also while it has no commit yet
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("first", async () => {
          await agent("one", "one")
          await agent("two", "two")
        })
        await slice("second", async () => {
          await agent("three", "three")
        })
      }
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → one"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): one → two"
    And a file "b.txt" with:
      """
      b
      """
    And gtd lands "gtd(agent): two → three"
    Then the slices are:
      """
      first (closed)
        gtd(human): idle → one
        gtd(agent): one → two
        gtd(agent): two → three
      second (open)
      """

  Scenario: after a restart the next episode enters the same slice name, its ranges starting at its own base
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, restart, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await slice("work", async () => {
          await agent("building", "build it")
          await agent("checking", "check it")
        })
        await restart()
      }
      """
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
    And a file "NOTE.md" with:
      """
      Build another thing.
      """
    And gtd lands "gtd(human): idle → building"
    Then the slices are:
      """
      work (open)
        gtd(human): idle → building
      """

  Scenario: a slice inside a scope keeps its own name while the steps take the scope prefix
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, scope, slice } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await scope("build", async () => {
          await slice("refactor", async () => {
            await agent("fixing", "fix it")
            await agent("tidying", "tidy it")
          })
        })
      }
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → build.fixing"
    And a file "a.txt" with:
      """
      a
      """
    And gtd lands "gtd(agent): build.fixing → build.tidying"
    Then the slices are:
      """
      refactor (open)
        gtd(human): idle → build.fixing
        gtd(agent): build.fixing → build.tidying
      """
