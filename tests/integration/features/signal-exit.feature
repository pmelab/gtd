@live
Feature: A signal death reports the promised exit status and leaves nothing half-written

  gtd installs no handler that swallows SIGINT/SIGTERM into a chosen exit
  code — it removes its own listener and re-raises the signal once the
  runtime's own interruption has unblocked whatever it was doing, so a
  parent's `wait` sees a genuine signal death (`WIFSIGNALED`), not a
  `process.exit(130)` that merely reuses the same number. The signal is sent to
  a `gtd next` parked on a gate: a `git` shim that blocks the first
  `git log --first-parent` call and reports its pid. That call is an async
  child process, so the runtime's signal listener is live and interrupts the
  suspended fiber; a synchronous call would block the main thread instead. gtd
  writes no files and touches no git dir itself, so both scenarios assert the
  working tree and the git dir are exactly as they were before the signal.
  `@live` only: the in-memory tier never spawns a real process to signal.

  Scenario: SIGINT kills a spawned gtd next with status 130
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, read } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write .gtd/NEXT.md to start" })
        await agent("building", `Implement:\n${read(".gtd/NEXT.md") ?? ""}`)
      }
      """
    And a file ".gtd/NEXT.md" with:
      """
      build the thing
      """
    And gtd lands "gtd(human): idle → building"
    And the git index has settled
    And I snapshot the repository
    When I send SIGINT to a spawned gtd next
    Then the reported exit status is 130
    And the child was still alive when the signal landed
    And the git status is clean
    And the repository snapshot is unchanged

  Scenario: SIGTERM kills a spawned gtd next with status 143
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, read } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write .gtd/NEXT.md to start" })
        await agent("building", `Implement:\n${read(".gtd/NEXT.md") ?? ""}`)
      }
      """
    And a file ".gtd/NEXT.md" with:
      """
      build the thing
      """
    And gtd lands "gtd(human): idle → building"
    And the git index has settled
    And I snapshot the repository
    When I send SIGTERM to a spawned gtd next
    Then the reported exit status is 143
    And the child was still alive when the signal landed
    And the git status is clean
    And the repository snapshot is unchanged
