@inmem
Feature: gtd validate — self-validating the resolved rest's steering file

  `gtd validate` (see src/program.ts) resolves the current rest exactly like
  `gtd next`, renders that state's `file:`, and evaluates it per its `mode:`.
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

  In the bundled template the `qa` mode governs `.gtd/REQUIREMENTS.md` at
  design.triage and `.gtd/ARCHITECTURE.md` at architecture.author.

  Scenario: a well-formed REQUIREMENTS.md at design.triage validates cleanly
    Given a test project
    And the workflow
    And a commit "gtd(human): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing. Plan: add src/thing.ts exporting `thing`.

      ## Open Questions

      ### Should thing export a default too?

      No, named export only.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/REQUIREMENTS.md: valid"

  Scenario: a malformed REQUIREMENTS.md at design.triage fails with the parser's finding
    Given a test project
    And the workflow
    And a commit "gtd(human): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing.

      ## Open Questions

      ###

      A question heading with no question text.
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains ".gtd/REQUIREMENTS.md is not valid"
    And stderr contains "has no question text"
    And stderr contains "does not pass its own validation script"

  Scenario: a well-formed REVIEW.md at build.review.reviewing validates cleanly
    Given a test project
    And the workflow
    And a commit "gtd(human): build.review.reviewing" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1
      new export
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/REVIEW.md: valid"

  Scenario: a malformed REVIEW.md at build.review.reviewing fails with the parser's finding
    Given a test project
    And the workflow
    And a commit "gtd(human): build.review.reviewing" that adds ".gtd/REVIEW.md" with:
      """
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1
      new export
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains ".gtd/REVIEW.md is not valid"
    And stderr contains "# Review: <hash>"

  Scenario: a state with a file: but no mode: has nothing to validate
    Given a test project
    And the workflow
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains "nothing to validate at \"idle\""

  Scenario: a state with a file: but no mode: still has nothing to validate, in plain text
    # No more --json here (validate is plain-text only now) — there is no
    # file/script pair to pin any more, just the same "nothing to validate"
    # line every no-op prints.
    Given a test project
    And the workflow
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains "nothing to validate at \"idle\""

  Scenario: gtd next --sh at a first-write beat (the steering file does not exist yet) still emits a gtd_validate= assignment
    # Package 2, Requirement A: `resolveValidateScript` used to short-circuit
    # to `undefined` at exactly this beat (the `fs.exists` check happened in
    # TS-land, before the turn had written anything), silencing every
    # driver's `while [ -n "$gtd_validate" ]` repair loop right when it is
    # needed most. Existence is now a leading `[ -f <file> ] || exit 0` guard
    # INSIDE the emitted script instead, so `gtd_validate` is always assigned
    # whenever the resting state declares both `file:` and `mode:`.
    Given a test project
    And the workflow
    And an empty commit "gtd(human): design.triage"
    When I run gtd next with "--sh"
    Then it succeeds
    And stdout contains "gtd_validate="
    And stdout contains "gtd check qa"

  Scenario: plain `gtd next` appends the self-validation instruction at a producing agent state
    Given a test project
    And the workflow
    And a commit "gtd(human): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing.
      """
    When I run gtd next
    Then it succeeds
    # The instruction names the MODE's own resolved validation command — for a
    # built-in format that is the leaf `gtd check` invocation the compiler
    # seeds — not `gtd validate`, which now only prints a script.
    And stdout contains "run `gtd check qa '.gtd/REQUIREMENTS.md'`"
    And stdout contains "fix every violation"

  Scenario: `gtd next --json` withholds the self-validation instruction but embeds the validate script
    Given a test project
    And the workflow
    And a commit "gtd(human): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And stdout does not contain "Before finishing your turn"
    And the json field "validate" contains "gtd check qa"

  Scenario: gtd validate leaves the file untouched when the mode declares no formatter
    # The built-in `qa`/`review` modes VALIDATE only — gtd ships no formatter of
    # its own. A long prose line stays exactly as committed unless the project
    # plugs a `format:` command into the mode (see steering-modes.feature and
    # formatting.feature).
    Given a test project
    And the workflow
    And a commit "gtd(human): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing. This is a deliberately long single prose line that clearly exceeds the eighty character print width, and nothing rewraps it.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And the git status is clean

  Scenario: gtd land no longer runs format/validate — a malformed edit lands, and gtd validate is what still catches it
    Given a test project
    And the workflow
    And a commit "gtd(human): design.gate.answer" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing. Plan: do it.
      """
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a thing. Plan: do it.

      ## Open Questions

      ###

      The human deleted the question text.
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains "does not pass its own validation script"
    And stderr contains "has no question text"
    # Package 2, Requirement A: the landing script itself carries no
    # format/validate command any more — only the HEAD assertion and the
    # commit — so the same malformed edit lands regardless. Catching it is a
    # driver contract now (running `gtd next --json`'s own `validate` field,
    # or `gtd validate`, ahead of `gtd land`), not a gtd guarantee baked into
    # `gtd land` itself.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → design.triage"

  Scenario: the step gate captures a human's valid edit (routing it back to design.triage)
    Given a test project
    And the workflow
    And a commit "gtd(human): design.gate.answer" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing.
      """
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a thing. Plan: add src/thing.ts exporting `thing`, with a named
      export only.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → design.triage"

  Scenario: a state-level "model:" is rejected at load time — a machine's own model is the only way to declare one
    # A state's `model:` moved to the machine that owns it back in the
    # machine-scoped-memory restructure (src/PatternConfig.ts's
    # `LEGACY_STATE_KEY_HINTS`) — the compiler now points a stale `.gtdrc`
    # authoring it directly on a state at the machine-level replacement
    # (`machines.<name>.model`) instead of a bare "unknown key". This is a
    # config LOAD failure (before `gtd validate` ever reaches a steering
    # file), so any command surfaces it identically — `gtd validate` is as
    # good a home for it as any other, alongside this file's other
    # validate-error scenarios.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": working
              working:
                actor: agent
                model: smart
                prompt: "go"
                on:
                  "* **": idle
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "unknown key"
    And stderr contains "model"
    And stderr contains "machine"
