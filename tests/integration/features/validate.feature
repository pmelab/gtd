@inmem
Feature: gtd validate — self-validating the resolved rest's steering file

  `gtd validate` (see src/program.ts) resolves the current rest exactly like
  `gtd status`, renders that state's `file:`, and evaluates it per its `mode:`.
  For the two BUILT-IN modes that means reading the working-tree contents and
  running gtd's own parser — `qa` -> src/OpenQuestions.ts, `review` ->
  src/ReviewDoc.ts (the SAME pure parsers the LSP publishes as diagnostics, so
  there is one source of truth per format and no bash port). A mode may also
  declare shell commands; that is steering-modes.feature's subject.
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
    And the "simple" workflow
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing. Plan: add src/thing.ts exporting `thing`.

      ## Open Questions

      ### Should thing export a default too?

      No, named export only.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/TODO.md: valid"

  Scenario: a malformed TODO.md at grilling fails with the parser's finding
    Given a test project
    And the "simple" workflow
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing.

      ## Open Questions

      ###

      A question heading with no question text.
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains ".gtd/TODO.md is not valid"
    And stderr contains "has no question text"

  Scenario: --json reports the valid verdict structurally
    Given a test project
    And the "simple" workflow
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
    And the "simple" workflow
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
    And the "simple" workflow
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
    And the "simple" workflow
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains "nothing to validate at \"idle\""

  Scenario: plain `gtd next` appends the self-validation instruction at a producing agent state
    Given a test project
    And the "simple" workflow
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "run `gtd validate`"
    And stdout contains "fix every violation"

  Scenario: `gtd next --json` withholds the instruction — the driving loop owns the validate-and-retry step
    Given a test project
    And the "simple" workflow
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"grilling\""
    And stdout does not contain "gtd validate"

  Scenario: gtd validate leaves the file untouched when the mode declares no formatter
    # The built-in `qa`/`review` modes VALIDATE only — gtd ships no formatter of
    # its own. A long prose line stays exactly as committed unless the project
    # plugs a `format:` command into the mode (see steering-modes.feature and
    # formatting.feature).
    Given a test project
    And the "simple" workflow
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing. This is a deliberately long single prose line that clearly exceeds the eighty character print width, and nothing rewraps it.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And the git status is clean

  Scenario: the step gate runs format + validate after a human edits the steering file — a malformed edit is refused
    # A human answers at grilling-answer but leaves a `### ` question heading
    # with no question text. Stepping runs the same gate the producing agent
    # gets, so the malformed edit is refused and nothing is committed — the
    # evaluation happens after a human edit too.
    Given a test project
    And the "simple" workflow
    And a commit "gtd(human): grilling-answer" that adds ".gtd/TODO.md" with:
      """
      Build a thing. Plan: do it.
      """
    Given ".gtd/TODO.md" is modified to:
      """
      Build a thing. Plan: do it.

      ## Open Questions

      ###

      The human deleted the question text.
      """
    When I run gtd step human
    Then it fails
    And stderr contains "is not valid"
    And the last commit subject is "gtd(human): grilling-answer"

  Scenario: the step gate captures a human's valid edit (routing it back to grilling)
    Given a test project
    And the "simple" workflow
    And a commit "gtd(human): grilling-answer" that adds ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    Given ".gtd/TODO.md" is modified to:
      """
      Build a thing. Plan: add src/thing.ts exporting `thing`, with a named
      export only.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
