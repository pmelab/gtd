@inmem
Feature: a process runs on gtd/<branch> and keeps its history ref

  Every process starts on `gtd/<b>`, so the user's branch `<b>` never carries
  its commits. The closing commit records `Gtd-Branch: <b>`. A finished or
  abandoned process keeps `refs/gtd/history/<entry>`, pushed to
  `config.historyRemote` when that is set.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow(async function work() {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      })

      export const side = workflow(async function side() {
        await agent("sidework", "do the side work")
      })

      export const config = { historyRemote: "origin" }
      """
    And the working tree is committed as "chore: gtd config"
    And I mark the current commit as "base"

  Scenario: the ordinary start lands on gtd/<b> and leaves <b> unmoved
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"
    And the current branch is "gtd/main"
    And the branch "main" is at "base"

  Scenario: gtd start <name> lands its first commit on gtd/<b>
    When I run gtd with args "start side"
    Then it succeeds
    And the current branch is "gtd/main"
    And the branch "main" is at "base"

  Scenario: a finished process switches HEAD back to <b> and records the user's branch
    Given a remote "origin" that accepts pushes
    And a file "NOTE.md" with:
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
    And gtd lands "gtd(agent): building → gtd:unpin"
    When I run the unpin beat
    Then it succeeds
    And the current branch is "main"
    And the branch "main" is at "base"
    And the branch "gtd/main" tip message contains "Gtd-Branch: main"
    When I mark the branch "gtd/main" tip as "tip"
    Then the history ref of "entry" points at "tip"
    And the remote "origin" holds the history ref of "entry" at "tip"
    When I run gtd with args "history list"
    Then stdout contains " main "

  Scenario: a failed history push exits non-zero after the closing commit landed
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
    And gtd lands "gtd(agent): building → gtd:unpin"
    When I run the unpin beat
    Then it fails
    And the current branch is "main"
    And the branch "gtd/main" tip subject is "gtd(check): gtd:unpin → idle"
    And stderr contains "git push --force 'origin'"

  Scenario: starting reuses a gtd/<b> whose tip is contained in <b>
    Given a branch "gtd/main" at the current commit
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the current branch is "gtd/main"
    And the branch "main" is at "base"

  Scenario: starting refuses a gtd/<b> that holds commits outside <b>
    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    And the working tree is committed as "feat: unshipped"
    And a branch "gtd/main" at the current commit
    And I hard-reset to "base"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it fails
    And stderr contains "gtd/main"

  Scenario: abandon keeps a history ref, returns to <b> with the work pending, and restore brings gtd/<b> back
    Given a remote "origin" that accepts pushes
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I mark the current commit as "entry"
    When I run gtd with args "abandon"
    Then it succeeds
    And the current branch is "main"
    And the branch "gtd/main" does not exist
    And "NOTE.md" exists
    And the history ref of "entry" points at "entry"
    And the remote "origin" holds the history ref of "entry" at "entry"
    When I run gtd with args "history list"
    Then stdout contains " - "
    Given the file "NOTE.md" is deleted
    When I run gtd with args "restore"
    Then it succeeds
    And the current branch is "gtd/main"
    And the last commit subject is "gtd(human): idle → building"
    And the branch "main" is at "base"

  Scenario: restore refuses to reset a gtd/<b> made after abandon that holds other commits
    Given a remote "origin" that accepts pushes
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I run gtd with args "abandon"
    And the file "NOTE.md" is deleted
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And the working tree is committed as "feat: after abandon"
    And I mark the current commit as "after"
    And a branch "gtd/main" at the current commit
    And I hard-reset to "base"
    When I run gtd with args "restore"
    Then it fails
    And stderr contains "gtd/main"
    And the branch "gtd/main" is at "after"

  Scenario: restore stays on <b> when the process ran on <b> itself
    Given a remote "origin" that accepts pushes
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And I mark the current commit as "entry"
    And a branch "feature" at the current commit
    And the branch "feature" is checked out
    When I run gtd with args "abandon"
    Then it succeeds
    And the current branch is "feature"
    Given the file "NOTE.md" is deleted
    When I run gtd with args "restore"
    Then it succeeds
    And the current branch is "feature"
    And the branch "feature" is at "entry"
    And the branch "gtd/feature" does not exist
