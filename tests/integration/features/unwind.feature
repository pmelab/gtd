@inmem
Feature: revert scripts undo a commit in the working tree, never the index

  `revertScript` prints a script that reverse-applies the commit that started
  the process to the working tree. The index is left alone, so the revert
  shows as an unstaged change until the driver's landing script commits it —
  gtd itself never writes git.

  `restoreScript` undoes one commit's edits to named paths — each back to its
  content before that commit, or away when the commit added it — but only
  while the path is still exactly as that commit left it. `requireRevert`
  then refuses the landing while any of those paths still differs, naming it,
  whatever left it so.

  Scenario: the revert removes the sketch as an unstaged deletion
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, head, human, revertScript, run } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write .gtd/TODO.md to start" })
        const commit = head()
        await run("unwind", revertScript(commit, ".gtd/FEEDBACK.md", `could not unwind ${commit}`))
        await agent("build", "build it")
      }
      """
    And a file ".gtd/TODO.md" with:
      """
      sketch: add a greeting
      """
    And gtd lands "gtd(human): idle → unwind"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/TODO.md" does not exist
    And ".gtd/FEEDBACK.md" does not exist
    And the git status contains " D .gtd/TODO.md"
    And the git status does not contain "D  .gtd/TODO.md"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → build"

  Scenario: notes already committed to TODO.md survive a start
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, head, human, revertScript, run } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write .gtd/TODO.md to start" })
        const commit = head()
        await run("unwind", revertScript(commit, ".gtd/FEEDBACK.md", `could not unwind ${commit}`))
        await agent("build", "build it")
      }
      """
    And a file ".gtd/TODO.md" with:
      """
      ## Later

      - keep this line
      """
    And the working tree is committed
    And a file ".gtd/TODO.md" with:
      """
      sketch: add a greeting

      ## Later

      - keep this line
      """
    And gtd lands "gtd(human): idle → unwind"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/TODO.md" contains "## Later"
    And ".gtd/TODO.md" contains "- keep this line"
    And ".gtd/TODO.md" does not contain "sketch: add a greeting"

  Scenario: the restore reverts a hand-edited line and removes an added file, leaving .gtd/ alone
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, codeChanges, head, human, requireRevert, restoreScript, run } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await agent("build", "build it")
        await human("review", { message: "edit code to give feedback" })
        const base = head()
        const edited = codeChanges()
        await agent("collect", "write .gtd/REQUIREMENTS.md")
        await run(
          "re-unwind",
          restoreScript(base, {
            restore: edited.filter((c) => c.status !== "added").map((c) => c.path),
            remove: edited.filter((c) => c.status === "added").map((c) => c.path),
          }),
        )
        requireRevert(edited, base)
        await agent("triage", "plan it")
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → build"
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build → review"
    And "src/thing.ts" is modified to:
      """
      export const thing = 1
      // TODO: also export doubled
      """
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file ".gtd/marker.md" with:
      """
      keep this — under .gtd/, must survive the revert
      """
    And gtd lands "gtd(human): review → collect"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Export doubled.
      """
    And gtd lands "gtd(agent): collect → re-unwind"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → triage"
    And "src/thing.ts" does not contain "TODO"
    And "src/calc.ts" does not exist
    And ".gtd/marker.md" exists

  Scenario: a round with no code edit restores nothing and still advances
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, codeChanges, head, human, requireRevert, restoreScript, run } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await agent("build", "build it")
        await human("review", { message: "edit code to give feedback" })
        const base = head()
        const edited = codeChanges()
        await agent("collect", "write .gtd/REQUIREMENTS.md")
        await run(
          "re-unwind",
          restoreScript(base, {
            restore: edited.filter((c) => c.status !== "added").map((c) => c.path),
            remove: edited.filter((c) => c.status === "added").map((c) => c.path),
          }),
        )
        requireRevert(edited, base)
        await agent("triage", "plan it")
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → build"
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build → review"
    And a file ".gtd/NOTES.md" with:
      """
      looks great, nice work
      """
    And gtd lands "gtd(human): review → collect"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Nothing to change.
      """
    And gtd lands "gtd(agent): collect → re-unwind"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → triage"
    And the git status is clean

  Scenario: requireRevert refuses while an edited path is un-reverted, then a hand-revert recovers
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, codeChanges, head, human, requireRevert, restoreScript, run } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await agent("build", "build it")
        await human("review", { message: "edit code to give feedback" })
        const base = head()
        const edited = codeChanges()
        await agent("collect", "write .gtd/REQUIREMENTS.md")
        await run(
          "re-unwind",
          restoreScript(base, {
            restore: edited.filter((c) => c.status !== "added").map((c) => c.path),
            remove: edited.filter((c) => c.status === "added").map((c) => c.path),
          }),
        )
        requireRevert(edited, base)
        await agent("triage", "plan it")
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → build"
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build → review"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd lands "gtd(human): review → collect"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Export a sum alias.
      """
    And gtd lands "gtd(agent): collect → re-unwind"
    # The restore applied nothing: not running the script is how this
    # scenario leaves the tree exactly as a failed apply would.
    When I run gtd land
    Then it fails
    And stderr contains "gtd land: require-revert"
    And stderr contains "src/calc.ts"
    And the last commit subject is "gtd(agent): collect → re-unwind"
    # The guard reads the tree, not how the revert happened.
    Given the file "src/calc.ts" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → triage"
    And "src/calc.ts" does not exist

  Scenario: a path changed since the edit is left alone by the restore and refused by requireRevert
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, codeChanges, head, human, requireRevert, restoreScript, run } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await agent("build", "build it")
        await human("review", { message: "edit code to give feedback" })
        const base = head()
        const edited = codeChanges()
        await agent("collect", "write .gtd/REQUIREMENTS.md")
        await run(
          "re-unwind",
          restoreScript(base, {
            restore: edited.filter((c) => c.status !== "added").map((c) => c.path),
            remove: edited.filter((c) => c.status === "added").map((c) => c.path),
          }),
        )
        requireRevert(edited, base)
        await agent("triage", "plan it")
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → build"
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build → review"
    And "src/thing.ts" is modified to:
      """
      export const thing = 1
      // TODO: also export doubled
      """
    And gtd lands "gtd(human): review → collect"
    # The collecting turn rewrites the very line the human's edit touched.
    And "src/thing.ts" is modified to:
      """
      export const thing = 1
      // TODO: something else entirely landed here first
      """
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Export doubled.
      """
    And gtd lands "gtd(agent): collect → re-unwind"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it fails
    And stderr contains "gtd land:"
    And stderr contains "src/thing.ts"
    And "src/thing.ts" contains "something else entirely"
    And the last commit subject is "gtd(agent): collect → re-unwind"
