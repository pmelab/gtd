Feature: kept tips — a keep step's turn is set aside off the branch

  A `keep: true` agent step lands as an empty marker commit on the branch. Its
  real turn becomes an off-branch commit under refs/gtd/kept/<entry>/<step>/<hash>,
  which no landing deletes and `gtd history` never lists.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, kept } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("naive", "write the naive version", { keep: true })
        while (kept("naive")?.changes.get("src/naive.ts")?.after?.includes("redo")) {
          await agent("naive", "write the naive version again", { keep: true })
        }
        const tip = kept("naive")
        const seen = (tip?.changes ?? []).map((c) => c.path + " = " + c.after).join("; ")
        await agent("checking", "check the result: " + seen)
        if (kept("never-kept") === undefined) {
          await agent("none", "nothing was kept for never-kept")
        }
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → naive"
    And I mark the current commit as "entry"

  @inmem
  Scenario: landing a keep step leaves a marker on the branch and the turn under the kept ref
    Given I mark the current commit as "before"
    And a file "src/naive.ts" with:
      """
      export const naive = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): naive → checking"
    And the last commit body contains "Gtd-Step: naive#1"
    And the last commit body contains "Gtd-Format: 1"
    And "src/naive.ts" is not in the tree of "HEAD"
    And "src/naive.ts" does not exist
    And the git status is clean
    Given I mark the kept ref of "entry" for step "naive" as "kept"
    Then the last commit body contains "Gtd-Kept: " followed by the hash of "kept"
    And "src/naive.ts" at "kept" contains "export const naive = 1"
    And the parent of "kept" is "before"

  @inmem
  Scenario: the branch's first-parent log holds no commit touching the kept turn's file
    Given a file "src/naive.ts" with:
      """
      export const naive = 1
      """
    When I run gtd land
    Then it succeeds
    And no commit on the first-parent log since "entry" touches "src/naive.ts"

  @inmem
  Scenario: gtd history lists only finished processes, and the kept ref is not a history ref
    Given a file "src/naive.ts" with:
      """
      export const naive = 1
      """
    When I run gtd land
    Then it succeeds
    When I run gtd with args "history list --json"
    Then it succeeds
    And no ref exists under "refs/gtd/history/"

  @inmem
  Scenario: a later step's prompt is built from the kept tip's changes
    Given a file "src/naive.ts" with:
      """
      export const naive = 1
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next
    Then stdout contains "check the result: src/naive.ts = export const naive = 1"
    And stdout does not contain "write the naive version"

  @inmem
  Scenario: keeping the same step twice files a ref per pass and kept() reads the second
    Given a file "src/naive.ts" with:
      """
      export const naive = "redo"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): naive"
    Given a file "src/naive.ts" with:
      """
      export const naive = "second"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): naive → checking"
    Given I mark the kept ref of "entry" for step "naive" as "kept"
    Then "src/naive.ts" at "kept" contains "second"
    And the last commit body contains "Gtd-Kept: " followed by the hash of "kept"
    When I run gtd next
    Then stdout contains "check the result: src/naive.ts = export const naive = \"second\""

  @inmem
  Scenario: a flow branching on kept() of a never-kept step reaches its none step
    Given a file "src/naive.ts" with:
      """
      export const naive = 1
      """
    When I run gtd land
    Then it succeeds
    Given a file "checked.txt" with:
      """
      ok
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next
    Then stdout contains "nothing was kept for never-kept"
