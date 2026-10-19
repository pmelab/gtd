@inmem
Feature: unwind reverts the sketch in the working tree, never the index

  `unwind` prints a script that reverse-applies the commit that started the
  process to the working tree. The index is left alone, so the
  revert shows as an unstaged change until the driver's landing script
  commits it — gtd itself never writes git.

  Scenario: the unwind removes the sketch as an unstaged deletion
    Given a test project
    And the workflow gtd install scaffolds
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
    And the last commit subject is "gtd(check): unwind → start-gate.check"

  Scenario: deferred review notes already on the branch survive a start
    Given a test project
    And the workflow gtd install scaffolds
    And a file ".gtd/TODO.md" with:
      """
      ## Deferred review notes (abcdef1)

      - note-1 — a.ts:3 (could: tiny): plain
      """
    And the working tree is committed
    And a file ".gtd/TODO.md" with:
      """
      sketch: add a greeting

      ## Deferred review notes (abcdef1)

      - note-1 — a.ts:3 (could: tiny): plain
      """
    And gtd lands "gtd(human): idle → unwind"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/TODO.md" contains "## Deferred review notes (abcdef1)"
    And ".gtd/TODO.md" contains "- note-1 — a.ts:3 (could: tiny): plain"
    And ".gtd/TODO.md" does not contain "sketch: add a greeting"
