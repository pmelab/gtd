Feature: carried kept passes — a redo starts on top of the previous kept pass

  A keep step that names a kept tip with `carry` begins its turn with that
  tip's changes back in the working tree, so its own kept commit holds both passes.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, kept } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("naive", "write the naive version", { keep: true })
        await agent("checking", "check the naive version")
        await agent("naive", "redo the naive version", { keep: true, carry: kept("naive") })
        const paths = (kept("naive")?.changes ?? []).map((c) => c.path).join(", ")
        await agent("done", "kept paths: " + paths)
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → naive"
    And I mark the current commit as "entry"
    And I run the pin beat
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And gtd lands "gtd(agent): naive → checking"

  @inmem
  Scenario: the redo turn begins with the previous pass in the tree and keeps both passes
    Given a file "checked.txt" with:
      """
      red
      """
    When I run gtd land
    Then it succeeds
    And "src/a.ts" contains "export const a = 1"
    Given a file "src/b.ts" with:
      """
      export const b = 2
      """
    When I run gtd land
    Then it succeeds
    And "src/a.ts" does not exist
    Given I mark the kept ref of "entry" for step "naive" as "kept"
    Then "src/a.ts" at "kept" contains "export const a = 1"
    And "src/b.ts" at "kept" contains "export const b = 2"
    When I run gtd next
    Then stdout contains "kept paths: src/a.ts, src/b.ts"

  @inmem
  Scenario: a redo that adds nothing to the restored pass is an empty attempt that restores it again
    Given a file "checked.txt" with:
      """
      red
      """
    When I run gtd land
    Then it succeeds
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): naive"
    And "src/a.ts" contains "export const a = 1"
    When I run gtd next
    Then stdout contains "stalled at \"naive\""
    Given a file "src/b.ts" with:
      """
      export const b = 2
      """
    When I run gtd land
    Then it succeeds
    Given I mark the kept ref of "entry" for step "naive" as "kept"
    Then "src/a.ts" at "kept" contains "export const a = 1"
    And "src/b.ts" at "kept" contains "export const b = 2"

  @inmem
  Scenario: a kept pass that does not apply refuses the landing and names its hash
    Given I mark the kept ref of "entry" for step "naive" as "kept"
    And a file "checked.txt" with:
      """
      red
      """
    And a file "src/a.ts" with:
      """
      export const a = "clash"
      """
    When I run gtd land
    Then it fails
    And stderr contains "gtd: kept pass"
    And stderr contains the hash of "kept"
    And the last commit subject is "gtd(agent): naive → checking"

  @inmem
  Scenario: a carry from the pass the same landing sets aside refuses the landing
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, kept } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("a", "first", { keep: true })
        await agent("b", "second", { keep: true, carry: kept("a") })
      }
      """
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it fails
    And stderr contains "carries the kept pass"

  @inmem
  Scenario: a keep step entering a carried step checks the carry against HEAD, not its own turn
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, kept } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("x", "first", { keep: true })
        await agent("y", "second", { keep: true })
        await agent("z", "third", { keep: true, carry: kept("x") })
      }
      """
    And the working tree is committed as "chore: carry config"
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And "src/a.ts" does not exist
    Given a file "src/a.ts" with:
      """
      export const a = "y"
      """
    When I run gtd land
    Then it succeeds
    And "src/a.ts" contains "export const a = 1"
