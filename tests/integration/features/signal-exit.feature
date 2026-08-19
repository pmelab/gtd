@live
Feature: A signal death reports the promised exit status and leaves nothing half-written

  gtd installs no handler that swallows SIGINT/SIGTERM into a chosen exit
  code — it removes its own listener and re-raises the signal once the
  runtime's own interruption has unblocked whatever it was doing, so a
  parent's `wait` sees a genuine signal death (`WIFSIGNALED`), not a
  `process.exit(130)` that merely reuses the same number. Both signals are
  sent to a `gtd next` spawned against a prompt padded past the OS pipe
  buffer — the same backpressure `pipe-truncation.feature` relies on — so the
  process is still alive, mid-write, when the signal arrives rather than
  racing its own natural exit. gtd writes no files and touches no git dir
  itself (every write happens inside a script it emitted and a driver ran),
  so an interrupted `gtd next` — a read command with nothing to drive — has
  nothing half-written to leave behind either way: both scenarios assert the
  working tree and the git dir are exactly as they were before the signal.
  `@live` only: the in-memory tier never spawns a real process to signal.

  Scenario: SIGINT kills a spawned gtd next with status 130
    Given a test project
    And the workflow
    And a file ".gtd/NEXT.md" padded to at least 200000 bytes with a repeating line
    And the working tree is committed as "chore: seed NEXT.md"
    And an empty commit "gtd(check): packages.picking → packages.item.building"
    And the git index has settled
    And I snapshot the repository
    When I send SIGINT to a spawned gtd next
    Then the reported exit status is 130
    And the git status is clean
    And the repository snapshot is unchanged

  Scenario: SIGTERM kills a spawned gtd next with status 143
    Given a test project
    And the workflow
    And a file ".gtd/NEXT.md" padded to at least 200000 bytes with a repeating line
    And the working tree is committed as "chore: seed NEXT.md"
    And an empty commit "gtd(check): packages.picking → packages.item.building"
    And the git index has settled
    And I snapshot the repository
    When I send SIGTERM to a spawned gtd next
    Then the reported exit status is 143
    And the git status is clean
    And the repository snapshot is unchanged
