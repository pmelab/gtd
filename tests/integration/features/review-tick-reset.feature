@live
Feature: Review checkboxes reset on land — a tick is read-progress, never sign-off

  At the human review gate (`build.review.await-review`), `gtd land`'s
  emitted script resets every `- [x]`/`- [X]` file-pointer box in
  `.gtd/REVIEW.md` back to `- [ ]` (via `gtd uncheck`) BEFORE it commits — a
  tick means "I read this hunk", never sign-off, and no record of which
  hunks were read survives the land, in history or on disk. This lets
  `build.review.deciding`'s own sign-off-vs-feedback check compare
  `.gtd/REVIEW.md` byte-for-byte across the human's commit with no
  `[ ]`/`[x]` normalization at all — no `[x]` can ever reach it.

  `qa`-mode's `- [ ]` boxes are a different format entirely: they ARE the
  answer, so `gtd uncheck` is never emitted at a `qa`-mode gate — only at the
  human `mode: review` gate (see `src/StepGuards.ts`'s `isHumanReviewGate`,
  shared by the guard and the emitted step).

  These scenarios actually EXECUTE the rendered scripts (`I execute the
  printed check script`) rather than simulating their outcome by hand — the
  reset and the sign-off/feedback classification both live in real shell
  logic, which `@inmem` scenarios never run (see AGENTS.md).

  Scenario: ticking boxes and changing nothing else is a clean sign-off — the ticks are gone from disk and the round reaches idle
    Given a test project
    And a commit "gtd(agent): build.health.check → build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"
    And ".gtd/REVIEW.md" contains "- [ ] ./src/calc.ts#1"
    And ".gtd/REVIEW.md" does not contain "[x]"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → idle"

  Scenario: ticking boxes and leaving a note is feedback — the commit carries the note, no tick, and routes to collecting
    Given a test project
    And a commit "gtd(agent): build.health.check → build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function — needs error handling too
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"
    And ".gtd/REVIEW.md" does not contain "[x]"
    And ".gtd/REVIEW.md" contains "needs error handling too"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.collecting"
    And ".gtd/REVIEW_RAW.md" exists

  Scenario: ticking a two-space-indented (nested) hunk is cleared at the review gate too — the live bug this rewrite fixes
    Given a test project
    And a commit "gtd(agent): build.health.check → build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
        - [ ] ./src/calc.ts#2
      """
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
        - [x] ./src/calc.ts#2
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"
    And ".gtd/REVIEW.md" contains "  - [ ] ./src/calc.ts#2"
    And ".gtd/REVIEW.md" does not contain "[x]"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → idle"

  Scenario: a '- [x]' line inside a fenced code block in a chunk description is never a hunk pointer, and ticking the chunk never touches it
    Given a test project
    And a commit "gtd(agent): build.health.check → build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      Example of the OLD format, quoted for context:

      ```
      - [x] ./src/legacy.ts#1
      ```

      - [ ] ./src/calc.ts#1
      new add function
      """
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      Example of the OLD format, quoted for context:

      ```
      - [x] ./src/legacy.ts#1
      ```

      - [x] ./src/calc.ts#1
      new add function
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"
    And ".gtd/REVIEW.md" contains "- [ ] ./src/calc.ts#1"
    And ".gtd/REVIEW.md" contains "- [x] ./src/legacy.ts#1"

  Scenario: a ticked answer at a qa-mode gate survives the land — gtd uncheck never runs there
    Given a test project
    And the workflow
    And a commit "gtd(agent): design.gate.answer" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [x] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → design.triage"
    And ".gtd/REQUIREMENTS.md" contains "[x] SQLite"
