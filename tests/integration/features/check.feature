Feature: gtd check <mode> <file> — the standalone leaf validator

  `gtd check <mode> <file>` (see src/program.ts's runCheckCommand) reads
  <file> and runs the named BUILT-IN steering format's pure parser over its
  contents — the same qa/review parsers gtd validate and the LSP use. Unlike
  every other gtd subcommand, both arguments are given explicitly: it resolves
  no workflow state and reads no config, so it needs neither a git repository
  nor a .gtdrc — the standalone command an emitted validation script (a later
  package) invokes as a leaf step, from any directory. A clean parse exits 0
  with no output; findings print one per line and it exits non-zero; an
  absent file mirrors gtd validate's own absent-file behavior (exit 0,
  nothing to check); an unrecognized <mode> is a usage error naming the modes
  that do exist.

  `--open-questions` (mode "qa" only) replaces that structural check with
  OpenQuestions.ts's `unansweredQuestions` predicate — the SAME one
  StepGuards.ts's answer-completeness guard enforces at land — printing each
  unanswered question's heading and exiting non-zero when any remain. Unlike
  the structural path, a missing (or unreadable) file is itself a non-zero
  exit naming the path, not "nothing to check": a workflow's gate script must
  stop and show the human rather than silently pass.

  @inmem
  Scenario: a well-formed qa file validates cleanly and exits 0 silently
    Given a file "NOTES.md" with:
      """
      Build a thing. Plan: add src/thing.ts exporting `thing`.

      ## Open Questions

      ### Should thing export a default too?

      No, named export only.
      """
    When I run gtd with args "check qa NOTES.md"
    Then it succeeds
    And stdout is empty

  @inmem
  Scenario: a malformed qa file prints the parser's findings, one per line, and fails
    Given a file "NOTES.md" with:
      """
      Build a thing.

      ## Open Questions

      ###

      A question heading with no question text.
      """
    When I run gtd with args "check qa NOTES.md"
    Then it fails
    And stdout contains "has no question text"

  @inmem
  Scenario: a well-formed review file validates cleanly and exits 0 silently
    Given a file "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1
      new export
      """
    When I run gtd with args "check review REVIEW.md"
    Then it succeeds
    And stdout is empty

  @inmem
  Scenario: a malformed review file prints the parser's findings and fails
    Given a file "REVIEW.md" with:
      """
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1
      new export
      """
    When I run gtd with args "check review REVIEW.md"
    Then it fails
    And stdout contains "# Review: <hash>"

  @inmem
  Scenario: a file that does not exist has nothing to check — exits 0 silently
    When I run gtd with args "check qa MISSING.md"
    Then it succeeds
    And stdout is empty

  @inmem
  Scenario: an unrecognized mode is a usage error naming the modes that do exist
    Given a file "whatever.md" with:
      """
      anything
      """
    When I run gtd with args "check bogus-mode whatever.md"
    Then it fails
    And stderr contains "unknown mode"
    And stderr contains "qa, review"

  @inmem
  Scenario: --json reports the clean verdict structurally
    Given a file "NOTES.md" with:
      """
      Build a thing. Plan: add src/thing.ts.
      """
    When I run gtd with args "check qa NOTES.md --json"
    Then it succeeds
    And stdout contains "{\"valid\":true,\"errors\":[]}"

  @inmem
  Scenario: --json reports findings structurally and still fails
    Given a file "NOTES.md" with:
      """
      Build a thing.

      ## Open Questions

      ###

      A question heading with no question text.
      """
    When I run gtd with args "check qa NOTES.md --json"
    Then it fails
    And stdout contains "\"valid\":false"
    And stdout contains "has no question text"

  @inmem
  Scenario: --json reports the clean verdict for an absent file too
    When I run gtd with args "check qa MISSING.md --json"
    Then it succeeds
    And stdout contains "{\"valid\":true,\"errors\":[]}"

  @inmem
  Scenario: --open-questions fails and names the unanswered question's heading
    Given a file "NOTES.md" with:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    When I run gtd with args "check qa NOTES.md --open-questions"
    Then it fails
    And stdout contains "Which storage backend?"

  @inmem
  Scenario: --open-questions succeeds silently once exactly one option is ticked
    Given a file "NOTES.md" with:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [x] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    When I run gtd with args "check qa NOTES.md --open-questions"
    Then it succeeds
    And stdout is empty

  @inmem
  Scenario: --open-questions succeeds silently over a file with an Answered Questions section only
    Given a file "NOTES.md" with:
      """
      Build a widget.

      ## Answered Questions

      ### Which storage backend?

      SQLite — zero-config, file-based.
      """
    When I run gtd with args "check qa NOTES.md --open-questions"
    Then it succeeds
    And stdout is empty

  @inmem
  Scenario: --open-questions on a missing file fails and names the path — unlike the no-flag path's silent exit 0
    When I run gtd with args "check qa MISSING.md --open-questions"
    Then it fails
    And stderr contains "MISSING.md"

  @live
  Scenario: gtd check runs standalone outside any git repository
    Given a plain directory that is not a git repository
    And a file "NOTES.md" with:
      """
      Build a thing. Plan: add src/thing.ts.
      """
    When I run gtd with args "check qa NOTES.md"
    Then it succeeds
    And stdout is empty
