Feature: gtd history — every finished process keeps its turns behind refs/gtd/history

  Background:
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

  @inmem
  Scenario: the landing that finishes a process writes its history ref
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
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → unpin"
    And the last commit body does not contain "Gtd-Branch"
    When I run the unpin beat
    Then the last commit subject is "gtd(check): unpin → idle"
    And the last commit body contains "Gtd-Branch: main"
    And the last commit body contains "Gtd-Version: "
    And the last commit body contains "Gtd-Format: 2"
    Given I mark the current commit as "tip"
    Then the history ref of "entry" points at "tip"

  @inmem
  Scenario: a landing that does not finish the process writes no history ref
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    When I run gtd with args "history list --json"
    Then it succeeds
    And stdout contains "[]"
    And the last commit body does not contain "Gtd-Version"

  @inmem
  Scenario: a second process on the same branch gets its own ref and leaves the first untouched
    Given a file "NOTE.md" with:
      """
      First.
      """
    And gtd lands "gtd(human): idle → building"
    And I mark the current commit as "first"
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And gtd lands "gtd(agent): building → unpin"
    And I run the unpin beat
    And I mark the current commit as "first-tip"
    And a file "NOTE.md" with:
      """
      Second.
      """
    And gtd lands "gtd(human): idle → building"
    And I mark the current commit as "second"
    And I run the pin beat
    And a file "src/b.ts" with:
      """
      export const b = 2
      """
    And gtd lands "gtd(agent): building → unpin"
    And I run the unpin beat
    And I mark the current commit as "second-tip"
    Then the history ref of "first" points at "first-tip"
    And the history ref of "second" points at "second-tip"
    When I run gtd with args "history list --json"
    Then it succeeds
    And stdout contains the hash of "first"
    And stdout contains the hash of "second"

  @inmem
  Scenario: an empty list hints at gtd history fetch and still succeeds
    When I run gtd with args "history list"
    Then it succeeds
    And stdout contains "gtd history fetch | sh"

  @live
  Scenario: gtd abandon writes no history ref
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    When I run gtd with args "abandon"
    Then it succeeds
    And no ref under "refs/gtd/history/" was created

  @live
  Scenario: a ref replays by entry hash prefix and by branch name after its branch is deleted
    Given a new branch "feat/thing" is checked out
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
    And gtd lands "gtd(agent): building → unpin"
    And I run the unpin beat
    When I run in the shell:
      """
      git checkout -q main
      git branch -D feat/thing
      """
    And I run gtd with args "history show feat/thing"
    Then it succeeds
    And stdout contains "gtd(human): idle → building"
    And stdout contains "gtd(agent): building → unpin"
    And stdout contains "ended (return)"
    When I run gtd with args "history show" followed by the first 7 characters of the hash of "entry"
    Then it succeeds
    And stdout contains "gtd(agent): building → unpin"

  @inmem
  Scenario: a config file edited since the ref's tip refuses the replay
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
    And gtd lands "gtd(agent): building → unpin"
    And I run the unpin beat
    And the file "gtd.config.ts" ends with:
      """
      // edited after the process finished
      """
    When I run gtd with args "history show main"
    Then the exit code is 1
    And stderr contains "gtd.config.ts"
    And stdout is empty

  @live
  Scenario: a ref written by another gtd version warns and still prints the trail
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
    And gtd lands "gtd(agent): building → unpin"
    And I run the unpin beat
    When I run in the shell:
      """
      git log -1 --format=%B | sed 's/^Gtd-Version: .*/Gtd-Version: 0.0.1 (dev)/' > "$(git rev-parse --git-dir)/gtd-msg"
      git commit -q --amend -F "$(git rev-parse --git-dir)/gtd-msg"
      git update-ref "refs/gtd/history/$(git rev-parse entry)" HEAD
      """
    And I run gtd with args "history show main"
    Then it succeeds
    And stdout contains "gtd(agent): building → unpin"
    And stderr contains "0.0.1"
    And stderr contains the gtd version under test
    When I run gtd with args "history show main --json"
    Then it succeeds
    And stdout contains "\"versionWarning\""
    When I run gtd with args "history show main --json=version.recorded"
    Then it succeeds
    And stdout is:
      """
      0.0.1 (dev)
      """

  @live
  Scenario: on a fresh clone of a squashed, merged and deleted branch, fetch then show prints the original trail
    Given a bare git remote "origin"
    And a new branch "feat/thing" is checked out
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
    And gtd lands "gtd(agent): building → unpin"
    And I run the unpin beat
    When I run in the shell:
      """
      git push -q origin 'refs/gtd/history/*'
      git checkout -q main
      git merge -q --squash feat/thing
      git commit -q -m "feat: thing"
      git branch -D feat/thing
      git push -q origin main
      """
    Given the scenario continues in a fresh clone of remote "origin"
    When I run gtd with args "history list"
    Then it succeeds
    And stdout contains "gtd history fetch | sh"
    When I run gtd with args "history fetch" piped to sh
    Then it succeeds
    And stdout contains "1 history refs arrived"
    When I run gtd with args "history show feat/thing"
    Then it succeeds
    And stdout contains "gtd(human): idle → building"
    And stdout contains "gtd(agent): building → unpin"
    And stdout contains "ended (return)"
