@inmem
Feature: ship() squashes the process onto the user's branch

  A `ship(name, message)` step lands like a check: its landing first commits
  the tree, with `.gtd/` as `<b>` has it, onto `<b>` as one commit, with
  `Gtd-History` and `Gtd-Tip` trailers, and moves `<b>` there. HEAD stays on `gtd/<b>`. The step
  resolves to the shipped commit's hash, or `undefined` when nothing shipped.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, ship } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
        const shipped = await ship("shipping", "feat: a thing")
        await agent(shipped === undefined ? "unshipped" : "shipped", "report")
      }

      export const config = { historyRemote: "origin" }
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "base"
    And a remote "origin" that accepts pushes

  Scenario: landing the ship step squashes the tree, with .gtd/ as <b> has it, onto <b>
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I mark the current commit as "entry"
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And a file ".gtd/notes.md" with:
      """
      process only
      """
    And gtd lands "gtd(agent): building → shipping"
    When I run the script beat
    Then it succeeds
    And the last commit subject is "gtd(check): shipping → shipped"
    And the last commit body contains "Gtd-Shipped: "
    And the process rests at "shipped"
    And the current branch is "gtd/main"
    And the branch "main" tip's parent is at "base"
    And the branch "main" tip message contains "feat: a thing"
    And the branch "main" tip message contains "Gtd-Tip: "
    And the branch "main" holds "src/a.ts" with:
      """
      export const a = 1
      """
    And the branch "main" holds no ".gtd/notes.md"
    When I mark the current commit as "landed"
    Then the history ref of "entry" points at "landed"
    And the remote "origin" holds the history ref of "entry" at "landed"

  Scenario: the ship keeps the .gtd/ files <b> tracks as <b> has them
    Given a file ".gtd/keep.md" with:
      """
      tracked on main
      """
    And the working tree is committed as "chore: track a gtd file"
    And I mark the current commit as "tracked"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And a file ".gtd/keep.md" with:
      """
      edited by the process
      """
    And gtd lands "gtd(agent): building → shipping"
    When I run the script beat
    Then it succeeds
    And the process rests at "shipped"
    And the branch "main" tip's parent is at "tracked"
    And the branch "main" holds "src/a.ts" with:
      """
      export const a = 1
      """
    And the branch "main" holds ".gtd/keep.md" with:
      """
      tracked on main
      """

  Scenario: a tree <b> already has ships nothing and resolves to undefined
    Given a file ".gtd/NOTE.md" with:
      """
      Nothing for the branch.
      """
    And gtd lands "gtd(human): idle → building"
    And I run the pin beat
    And a file ".gtd/done.md" with:
      """
      Built nothing for the branch.
      """
    And gtd lands "gtd(agent): building → shipping"
    When I run the script beat
    Then it succeeds
    And the last commit subject is "gtd(check): shipping → unshipped"
    And the process rests at "unshipped"
    And the branch "main" is at "base"

  Scenario: a process on a branch with no user branch ships nothing
    Given a branch "gtd/solo" at the current commit
    And the branch "gtd/solo" is checked out
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And gtd lands "gtd(agent): building → shipping"
    When I run the script beat
    Then it succeeds
    And the last commit subject is "gtd(check): shipping → unshipped"
    And the branch "main" is at "base"

  Scenario: a change on <b> the ship would revert stalls the step until the tree carries it
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And gtd lands "gtd(agent): building → shipping"
    And the branch "main" is checked out
    And a file "README.md" with:
      """
      changed on main
      """
    And the working tree is committed as "docs: readme"
    And I mark the current commit as "moved"
    And the branch "gtd/main" is checked out
    When I run gtd next with "--json"
    Then stdout contains "\"kind\":\"stalled\""
    And stdout contains "main changed outside this process"
    And stdout contains "README.md"
    Given a file "README.md" with:
      """
      changed on main
      """
    When I run the script beat
    Then it succeeds
    And the last commit subject is "gtd(check): shipping → shipped"
    And the branch "main" tip's parent is at "moved"
    And the branch "main" holds "README.md" with:
      """
      changed on main
      """
    And the branch "main" holds "src/a.ts" with:
      """
      export const a = 1
      """

  Scenario: a path both changed ships once the working tree carries <b>'s change
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I run the pin beat
    And a file "README.md" with:
      """
      from the process
      """
    And gtd lands "gtd(agent): building → shipping"
    And the branch "main" is checked out
    And a file "README.md" with:
      """
      from main
      """
    And the working tree is committed as "docs: readme"
    And the branch "gtd/main" is checked out
    When I run gtd next with "--json"
    Then stdout contains "\"kind\":\"stalled\""
    Given a file "README.md" with:
      """
      from main
      from the process
      """
    When I run the script beat
    Then it succeeds
    And the last commit subject is "gtd(check): shipping → shipped"
    And the branch "main" holds "README.md" with:
      """
      from main
      from the process
      """

  Scenario: finishing switches back to <b>, leaving work after the last ship on gtd/<b>
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I mark the current commit as "entry"
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And gtd lands "gtd(agent): building → shipping"
    And I run the script beat
    And I mark the current commit as "shipped"
    And a file "src/b.ts" with:
      """
      export const b = 2
      """
    And gtd lands "gtd(agent): shipped → gtd:unpin"
    When I run the script beat
    Then it succeeds
    And the current branch is "main"
    And the branch "main" holds "src/a.ts" with:
      """
      export const a = 1
      """
    And the branch "main" holds no "src/b.ts"
    And "src/b.ts" does not exist
    And the branch "gtd/main" tip message contains "gtd(check): gtd:unpin → idle"
    When I run gtd next
    Then it succeeds
    And stdout contains "State: idle"

  Scenario: abandoning after a ship rewinds to the last ship and switches back to <b>
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And gtd lands "gtd(agent): building → shipping"
    And I run the script beat
    And a file "src/b.ts" with:
      """
      export const b = 2
      """
    When I run gtd with args "abandon"
    Then it succeeds
    And the current branch is "main"
    And the branch "gtd/main" does not exist
    And the git status contains "src/b.ts"
    And the git status does not contain "src/a.ts"
