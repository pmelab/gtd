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

  In the bundled template the ADVANCED flow uses the `qa` mode
  (`.gtd/REQUIREMENTS.md` at design.product-author, `.gtd/ARCHITECTURE.md` at
  design.technical-author). The SIMPLE flow's `.gtd/TODO.md` iterates on a free-form plan
  under the format-only `prose` mode: it validates cleanly regardless of
  content (there is no validator to fail), but still formats on a declared
  `format:` command — formatting.feature covers that.

  Scenario: a well-formed REQUIREMENTS.md at design.product-author validates cleanly
    Given a test project
    And the workflow
    And a commit "gtd(human): design.product-author" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing. Plan: add src/thing.ts exporting `thing`.

      ## Open Questions

      ### Should thing export a default too?

      No, named export only.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/REQUIREMENTS.md: valid"

  Scenario: a malformed REQUIREMENTS.md at design.product-author fails with the parser's finding
    Given a test project
    And the workflow
    And a commit "gtd(human): design.product-author" that adds ".gtd/REQUIREMENTS.md" with:
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

  Scenario: --json reports the emitted script structurally
    # `--json` is the raw engine response: the resolved state, its file and
    # mode, and the `script` a driver runs to get the verdict. There is no
    # `valid` key — the verdict lives in that script's exit code, not this
    # command's, which is why `validate` itself always succeeds now.
    Given a test project
    And the workflow
    And a commit "gtd(human): design.product-author" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing. Plan: add src/thing.ts.
      """
    When I run gtd with args "validate --json"
    Then it succeeds
    And stdout contains "\"mode\":\"qa\""
    And stdout contains "\"file\":\".gtd/REQUIREMENTS.md\""
    And stdout contains "gtd check qa"
    And stdout contains "does not pass its own validation script"
    And stdout contains "Fix these format violations in .gtd/REQUIREMENTS.md"

  Scenario: a well-formed REVIEW.md at build.review.reviewing validates cleanly
    Given a test project
    And the workflow
    And a commit "gtd(human): build.review.reviewing" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1 — new export
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

      - [ ] ./src/thing.ts#1 — new export
      """
    When I run gtd with args "validate"
    Then it fails
    And stderr contains ".gtd/REVIEW.md is not valid"
    And stderr contains "# Review: <hash>"

  Scenario: a state with no file:/mode: has nothing to validate
    Given a test project
    And the workflow
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains "nothing to validate at \"idle\""

  Scenario: the simple flow's TODO.md is `prose`-moded — there is nothing to emit
    # The SIMPLE flow iterates on a free-form plan; planning declares `file:`
    # + `mode: prose`, an EMPTY modes: entry — no `format:`, no `validate:`.
    # A mode with no commands emits no script at all, which is exactly the
    # "nothing to validate" case: any content is acceptable.
    Given a test project
    And the workflow
    And a commit "gtd(human): plan.planning" that adds ".gtd/TODO.md" with:
      """
      Build a thing. Plan: add src/thing.ts exporting `thing`.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains "nothing to validate at \"plan.planning\""

  Scenario: plain `gtd next` appends the self-validation instruction at a producing agent state
    Given a test project
    And the workflow
    And a commit "gtd(human): design.product-author" that adds ".gtd/REQUIREMENTS.md" with:
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
    And a commit "gtd(human): design.product-author" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.product-author\""
    And stdout does not contain "Before finishing your turn"
    And the json field "validate" contains "gtd check qa"

  Scenario: gtd validate leaves the file untouched when the mode declares no formatter
    # The built-in `qa`/`review` modes VALIDATE only — gtd ships no formatter of
    # its own. A long prose line stays exactly as committed unless the project
    # plugs a `format:` command into the mode (see steering-modes.feature and
    # formatting.feature).
    Given a test project
    And the workflow
    And a commit "gtd(human): design.product-author" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing. This is a deliberately long single prose line that clearly exceeds the eighty character print width, and nothing rewraps it.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And the git status is clean

  Scenario: the step gate runs format + validate after a human edits the steering file — a malformed edit is refused
    # A human answers at product-answer but leaves a `### ` question heading
    # with no question text. Stepping runs the same gate the producing agent
    # gets, so the malformed edit is refused and nothing is committed — the
    # evaluation happens after a human edit too.
    Given a test project
    And the workflow
    And a commit "gtd(human): design.product-answer" that adds ".gtd/REQUIREMENTS.md" with:
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
    When I run gtd land
    Then it fails
    # The step's own required script runs the same validation ahead of its
    # commit, so the refusal is the checker's findings and a non-zero exit —
    # nothing is committed.
    And stderr contains "has no question text"
    And the last commit subject is "gtd(human): design.product-answer"

  Scenario: the step gate captures a human's valid edit (routing it back to design.product-author)
    Given a test project
    And the workflow
    And a commit "gtd(human): design.product-answer" that adds ".gtd/REQUIREMENTS.md" with:
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
    And the last commit subject is "gtd(human): design.product-answer → design.product-author"

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
