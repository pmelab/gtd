@inmem
Feature: A picking-arbiter example — a per-task queue loop via a custom workflow

  Coverage for the deterministic queue-arbiter shape the bundled workflow's
  per-package build queue uses: a `run` step (`picking`) that takes the first
  task file under `.gtd/tasks/` into `.gtd/NEXT.md`, or removes
  `.gtd/NEXT.md` once the queue is empty, inside a plain loop. The flow checks
  the deletion before any change to `.gtd/NEXT.md` — a deletion is a change
  too, so code order decides. A minimal custom workflow stands in for the
  fuller example; @inmem simulates the arbiter's script by writing/deleting
  `.gtd/NEXT.md` directly and running `gtd land`.

  Scenario: the arbiter feeds a two-task queue one task at a time, then closes out once it empties
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, refuse, run, workflow } from "@pmelab/gtd/flows"

      const pick = `next=$(ls .gtd/tasks/*.md 2>/dev/null | head -n 1)
      if [ -n "$next" ]; then
        printf '%s' "$next" > .gtd/NEXT.md
      else
        rm -f .gtd/NEXT.md
      fi
      `

      export default workflow(async () => {
        await human("idle", {
          message: "write task files under .gtd/tasks/, then run `gtd land`",
        })
        for (;;) {
          await run("picking", pick)
          // The empty-queue check comes first: a deletion is also a change to NEXT.md.
          if (changes(".gtd/NEXT.md").some((c) => c.status === "deleted") || changes().length === 0) break
          if (changes(".gtd/NEXT.md").length === 0) refuse("picking must write .gtd/NEXT.md")
          await agent("building", "Implement the task named in .gtd/NEXT.md, then delete that task file.")
        }
        await human("done", { message: "tasks complete" })
      })
      """
    And a file ".gtd/tasks/01-a.md" with:
      """
      Task A
      """
    And a file ".gtd/tasks/02-b.md" with:
      """
      Task B
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → picking"

    # picking (task 1 of 2): the arbiter takes the first task file by name
    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/tasks/01-a.md
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): picking → building"

    Given the file ".gtd/tasks/01-a.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → picking"

    # picking (task 2 of 2): overwrites NEXT.md with the one remaining task
    Given ".gtd/NEXT.md" is modified to:
      """
      .gtd/tasks/02-b.md
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): picking → building"

    Given the file ".gtd/tasks/02-b.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → picking"

    # picking: the queue is now empty — deleting NEXT.md is checked before any
    # other change to it and closes the process out via "done"
    Given the file ".gtd/NEXT.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): picking → done"
    And the git status is clean

  Scenario: an empty queue on the very first entry into picking leaves the loop on a clean tree directly
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, refuse, run, workflow } from "@pmelab/gtd/flows"

      const pick = `next=$(ls .gtd/tasks/*.md 2>/dev/null | head -n 1)
      if [ -n "$next" ]; then
        printf '%s' "$next" > .gtd/NEXT.md
      else
        rm -f .gtd/NEXT.md
      fi
      `

      export default workflow(async () => {
        await human("idle", {
          message: "write task files under .gtd/tasks/, then run `gtd land`",
        })
        for (;;) {
          await run("picking", pick)
          // The empty-queue check comes first: a deletion is also a change to NEXT.md.
          if (changes(".gtd/NEXT.md").some((c) => c.status === "deleted") || changes().length === 0) break
          if (changes(".gtd/NEXT.md").length === 0) refuse("picking must write .gtd/NEXT.md")
          await agent("building", "Implement the task named in .gtd/NEXT.md, then delete that task file.")
        }
        await human("done", { message: "tasks complete" })
      })
      """
    And a file "NOTE.md" with:
      """
      no tasks this time — just a placeholder edit
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → picking"

    # picking: .gtd/tasks/ was already empty, so a clean step leaves the loop directly
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): picking → done"
    And the git status is clean
