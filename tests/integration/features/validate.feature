@inmem
Feature: gtd validate — self-validating the resolved rest's steering file

  `gtd validate` (see src/program.ts) resolves the current rest exactly like
  `gtd status`, renders that state's `file:`, reads its working-tree contents,
  and runs the parser its `mode:` selects — `qa` -> src/OpenQuestions.ts,
  `review` -> src/ReviewDoc.ts (the SAME pure parsers the LSP publishes as
  diagnostics, so there is one source of truth per format and no bash port).
  It exits non-zero with findings when the file violates its format, and 0
  otherwise — the signal a producing agent (or the driving loop) loops on until
  the file is well-formed. A state with no `file:`/`mode:` has nothing to
  validate. It mutates nothing.

  This replaced the old in-machine validation states (`todo-validating`,
  `review-validating`) and their `.gtd/FORMAT.md` bounce loop: instead of a
  dedicated state, the producing agent self-validates before finishing, so a
  human gate is only ever handed a well-formed file.

  Scenario: a well-formed TODO.md at grilling validates cleanly
    Given a test project
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing. Plan: add src/thing.ts exporting `thing`.

      ## Open Questions

      ### Should thing export a default too?

      Suggested default: no, named export only.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/TODO.md: valid"

  Scenario: a malformed TODO.md at grilling fails with the parser's finding
    Given a test project
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing.

      ## Open Questions

      ### Should thing export a default too?

      Not sure yet.
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains ".gtd/TODO.md is not valid"
    And stderr contains "is missing a \"Suggested default: ...\" or \"Answer: ...\" line"

  Scenario: --json reports the valid verdict structurally
    Given a test project
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing. Plan: add src/thing.ts.
      """
    When I run gtd with args "validate --json"
    Then it succeeds
    And stdout contains "\"valid\":true"
    And stdout contains "\"mode\":\"qa\""

  Scenario: a well-formed REVIEW.md at reviewing validates cleanly
    Given a test project
    And a commit "gtd(human): reviewing" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1 — new export
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/REVIEW.md: valid"

  Scenario: a malformed REVIEW.md at reviewing fails with the parser's finding
    Given a test project
    And a commit "gtd(human): reviewing" that adds ".gtd/REVIEW.md" with:
      """
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1 — new export
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains ".gtd/REVIEW.md is not valid"
    And stderr contains "# Review: <hash>"

  Scenario: a state with no file:/mode: has nothing to validate
    Given a test project
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains "nothing to validate at \"idle\""

  Scenario: plain `gtd next` appends the self-validation instruction at a producing agent state
    Given a test project
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "run `gtd validate` and fix every violation"

  Scenario: `gtd next --json` withholds the instruction — the driving loop owns the validate-and-retry step
    Given a test project
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"grilling\""
    And stdout does not contain "gtd validate"
