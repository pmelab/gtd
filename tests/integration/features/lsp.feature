@live
Feature: gtd lsp — LSP server for .gtd/ steering files

  `gtd lsp` starts an LSP server over stdio for editors to attach to. These
  scenarios speak the real JSON-RPC wire protocol against the real built
  binary (never the in-memory tier — there's no separate process to pipe
  stdin/stdout to for a long-running server), covering: document symbols for
  open questions and review chunks/hunks, code actions that check/uncheck a
  hunk or a whole chunk, and the `gtd.openSteeringFile` command that asks the
  client to open whichever steering file matches the current state.

  Scenario: Document symbols surface each open question with its answered/suggested status
    Given a test project
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      ## Open Questions

      ### Which operations?

      Suggested default: add and subtract.

      ### What is the target platform?

      Answer: web only.
      """
    And a running gtd lsp server
    When I request document symbols for ".gtd/TODO.md"
    Then there are 2 document symbols
    And the document symbols include "[suggested] Which operations?"
    And the document symbols include "[answered] What is the target platform?"

  Scenario: Document symbols surface each review chunk and its hunks
    Given a test project
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calculator

      - [ ] ./src/calc.ts#1
      - [x] ./src/calc.ts#5 — subtract
      """
    And a running gtd lsp server
    When I request document symbols for ".gtd/REVIEW.md"
    Then there are 1 document symbols
    And the document symbols include "Add calculator (1/2)"
    And the first symbol's children include "[ ] ./src/calc.ts#1"
    And the first symbol's children include "[x] ./src/calc.ts#5 — subtract"

  Scenario: A code action checks a single unchecked hunk without touching the rest of the line
    Given a test project
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calculator

      - [ ] ./src/calc.ts#1
      - [ ] ./src/calc.ts#5 — subtract
      """
    And a running gtd lsp server
    When I request code actions at line containing "calc.ts#1" of ".gtd/REVIEW.md"
    And I apply the code action titled "gtd: check this hunk"
    Then the file ".gtd/REVIEW.md" contains "- [x] ./src/calc.ts#1"
    And the file ".gtd/REVIEW.md" contains "- [ ] ./src/calc.ts#5 — subtract"

  Scenario: A code action checks every hunk in a chunk at once
    Given a test project
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calculator

      - [ ] ./src/calc.ts#1
      - [ ] ./src/calc.ts#5 — subtract
      """
    And a running gtd lsp server
    When I request code actions at line containing "## Add calculator" of ".gtd/REVIEW.md"
    And I apply the code action titled "gtd: check all hunks in \"Add calculator\""
    Then the file ".gtd/REVIEW.md" contains "- [x] ./src/calc.ts#1"
    And the file ".gtd/REVIEW.md" contains "- [x] ./src/calc.ts#5 — subtract"

  Scenario: The openSteeringFile command asks the client to show REVIEW.md while resting at await-review
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calculator

      - [ ] ./src/calc.ts#1
      """
    And a running gtd lsp server
    When I run the gtd.openSteeringFile command
    Then the server asked to show document ".gtd/REVIEW.md"

  Scenario: The openSteeringFile command reports the state when no single file applies
    Given a test project
    And a running gtd lsp server
    When I run the gtd.openSteeringFile command
    Then the server showed an information message containing "idle"
