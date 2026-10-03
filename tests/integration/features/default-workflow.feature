Feature: The bundled unified workflow — one flow, end to end

  The bundled workflow is ONE flow: `idle` has exactly one next step,
  `unwind` — ANY change at all (a hand-edit to real code, a scratch
  note, or both) is a SKETCH, reverted out of the working tree by `unwind`
  before `start-gate.check` (the green-baseline gate) ever runs. There is no
  more fork on which steering file the human happened to create. Once
  green, `design.triage` groups the diff into ordered, classified concerns and
  raises PRODUCT open questions; the flow reads `.gtd/REQUIREMENTS.md` after
  each triage turn and rests the process at the `design.gate.answer` human
  gate only while some remain — a question-free phase skips the human stop
  entirely and falls straight through to `architecture.author`, a COLD reader
  that never resumes design's conversation. `architecture.gate.answer`
  mirrors the same shape for TECHNICAL questions in `.gtd/ARCHITECTURE.md`,
  then `architecture.decompose` mechanically writes one package file per
  concern. From there the flow builds the lexically first package under
  `.gtd/packages/` until none is left (`packages.*`), then runs the shared
  build tail (`build.*`): health/fix, one quality-lens review turn per
  lens, and the human review gate's sign-off-vs-feedback arbiter — a clean
  sign-off lands an ordinary commit straight into `idle`, retaining every
  prior per-turn commit on the branch; `gtd summary` afterward prints a
  closing-message prompt.

  Every `check`-actor state here (`start-gate.check`, `unwind`,
  `packages.item.health.check`, `packages.item.closing`, `build.health.check`,
  `build.review.closing`, `re-unwind`) is simulated on the `@inmem` scenarios
  below by writing or deleting its outcome files directly and running
  `gtd land` — `@inmem` never executes the scripts themselves. The scenarios
  that need `re-unwind`'s real scoped revert are tagged `@live`, running it
  for real via "I execute the printed check script", as is the one that
  pins what `gtd next` leaves behind in a real repository.

  Every scenario reaches its mid-flow step through a real replayed history —
  the bundled entries (`start-gate.check`, `fix-precheck`,
  `review-gate.check`) are the shortcuts, never a hand-authored state
  commit.

  @inmem
  Scenario: an ordinary code change starts the process — triage, both gates stop even when question-free, one package built/fixed/reviewed, then a clean review sign-off lands directly into idle
    Given a test project
    And the workflow
    # No steering file anywhere — a plain source edit is the whole start diff.
    And a file "src/greeter.ts" with:
      """
      export const greet = () => "hi"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"

    # unwind: simulate the revert — @inmem never executes
    # scripts — by reverting the working tree to the start commit ourselves.
    Given the file "src/greeter.ts" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → start-gate.check"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"

    # design.triage: groups the diff into concerns; no open product questions
    # here, so REQUIREMENTS.md carries no "## Open Questions" section
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export returning a friendly string.
      """
    # No open questions in REQUIREMENTS.md, so the flow skips the human stop
    # at design.gate.answer and goes straight on to architecture-pre
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.answer"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → architecture-pre"

    # architecture-pre: no verdict piped -> the conservative default runs
    # the full architecture pass, same as any other skipped judgment.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): architecture-pre → architecture.author"

    # architecture.author's prompt carries the settled-requirements exception
    # to its PERMISSIVE default: a simplification dropping something
    # REQUIREMENTS.md mentions is an open question, not a silent default.
    When I run gtd next
    Then it succeeds
    And stdout contains "is an open question, not a"

    # architecture.author: a COLD read of REQUIREMENTS.md — develops the how,
    # deletes the requirements file once folded in
    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: src/greeter.ts exports `greet`, no dependencies.
      """
    # again no open technical questions -> straight to decompose, no human
    # stop at architecture.gate.answer either
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): architecture.author → architecture.gate.answer"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): architecture.gate.answer → architecture.decompose"
    And the git log contains "design.gate.answer"
    And the git log contains "architecture.gate.answer"

    # decompose writes the package; the flow itself picks the lexically first
    # one to build
    Given the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-greeting.md" with:
      """
      Package: the greeting export. Independent tasks:
      - [ ] add src/greeter.ts exporting `greet`
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): architecture.decompose → packages.item.building"

    # packages.item.building's prompt names the bundled buildSkills pair, and
    # nothing else — ponytail is a scope-cutting lens, not a build-time skill.
    When I run gtd next
    Then stdout contains "test-driven-development, incremental-implementation"
    Then stdout does not contain "ponytail"

    # packages.item.building: implements the package (a real change relative
    # to the initial diff — a type annotation the package spec calls for)
    Given "src/greeter.ts" is modified to:
      """
      export const greet = (): string => "hi"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building → packages.item.health.check"

    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.health.check → packages.item.fix-suite"

    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.fix-suite → packages.item.health.check"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.health.check → packages.item.spec.pre"

    # spec.pre: a skipped judgment (bare land, no verdict) is the
    # conservative default — full review, never suppressed
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): packages.item.spec.pre → packages.item.spec.review"

    Given a file ".gtd/SPEC_FEEDBACK.md" with:
      """
      ## Missing doc comment

      greet() should be documented with a doc comment.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.fix-spec"

    Given the file ".gtd/SPEC_FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.fix-spec → packages.item.health.check"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.health.check → packages.item.spec.pre"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): packages.item.spec.pre → packages.item.spec.review"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.closing"

    # packages.item.closing: the queue is now drained -> the quality lap,
    # which every ordinary round pays for once, after the last package and
    # before any human sees the change. The per-package review above judged
    # that package's own spec coverage only; these lenses judge the code —
    # one build.quality.reviewing turn per bundled qualityReviews entry.
    Given the file ".gtd/packages/01-greeting.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.closing → build.quality.reviewing"

    # A clean lens turn (owasp-security) — nothing blocking, so no .gtd/QUALITY.md.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing"

    # The second lens (ponytail-review) is clean too.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing"

    # The third and final lens (test-audit) is clean too -> the lap has no
    # findings, straight on to human review.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing → build.review.reviewing"

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add greeter.ts

      - [ ] ./src/greeter.ts#1
      new export
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.reviewing → build.review.await-review"
    When I run gtd next
    Then it succeeds
    And stdout contains "State: build.review.await-review"

    # await-review: leave no comment -> sign-off (ticking the box just records that it was read)
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add greeter.ts

      - [x] ./src/greeter.ts#1
      new export
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → idle"
    And the git status is clean
    And ".gtd/REQUIREMENTS.md" does not exist
    And ".gtd/ARCHITECTURE.md" does not exist
    And ".gtd/packages/01-greeting.md" does not exist
    And ".gtd/REVIEW.md" does not exist
    And "src/greeter.ts" exists
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"idle\":true"
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      chore: init gtd workflow
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → architecture-pre
      gtd(judge): architecture-pre → architecture.author
      gtd(agent): architecture.author → architecture.gate.answer
      gtd(human): architecture.gate.answer → architecture.decompose
      gtd(agent): architecture.decompose → packages.item.building
      gtd(agent): packages.item.building → packages.item.health.check
      gtd(check): packages.item.health.check → packages.item.fix-suite
      gtd(agent): packages.item.fix-suite → packages.item.health.check
      gtd(check): packages.item.health.check → packages.item.spec.pre
      gtd(judge): packages.item.spec.pre → packages.item.spec.review
      gtd(agent): packages.item.spec.review → packages.item.fix-spec
      gtd(agent): packages.item.fix-spec → packages.item.health.check
      gtd(check): packages.item.health.check → packages.item.spec.pre
      gtd(judge): packages.item.spec.pre → packages.item.spec.review
      gtd(agent): packages.item.spec.review → packages.item.closing
      gtd(check): packages.item.closing → build.quality.reviewing
      gtd(agent): build.quality.reviewing
      gtd(agent): build.quality.reviewing
      gtd(agent): build.quality.reviewing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.await-review
      gtd(human): build.review.await-review → build.review.closing
      gtd(check): build.review.closing → idle
      """

  @inmem
  Scenario: an actionable review round loops back through re-unwind — the human's hand-edit is out of the tree by the time triage runs
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add greeting" that adds "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## greet
      - [ ] ./src/greet.ts#1
      new greeting
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    # await-review: a hand-edit to real code is feedback
    Given a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      // TODO: also export a sum() alias
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.closing"

    # build.review.closing: removes REVIEW.md; the round edited code outside
    # .gtd/, so it goes straight to collecting — no actionability judgment
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.collecting"

    # build.review.collecting: CLASSIFIES the round straight into
    # REQUIREMENTS.md (never an instruction list for a builder) -> the root's
    # own re-unwind
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Export a sum alias

      TECHNICAL — the review hand-edited `src/calc.ts` with a  # gtd-path-exempt: scenario fixture, not a repo file
      `// TODO: also export a sum() alias` comment; add a `sum` export
      alongside `add`.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → re-unwind"

    # re-unwind: simulate the revert — @inmem never executes
    # scripts — by reverting the human's hand-edit ourselves. The human's own
    # commit ADDED src/calc.ts, so a real reverse-apply of it DELETES the  # gtd-path-exempt: scenario fixture, not a repo file
    # file, not merely rewrites its content. The human's intent survives only
    # in their own "await-review → closing" commit, for design.triage to
    # read from history.
    Given the file "src/calc.ts" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → design.triage"
    And "src/calc.ts" does not exist
    And ".gtd/REQUIREMENTS.md" exists

  @inmem
  Scenario: re-unwind refuses to land while the human's review-round paths are still un-reverted, then a hand-revert recovers
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add greeting" that adds "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    # await-review: a hand-edit to real code is feedback
    Given a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      // TODO: also export a sum() alias
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.closing"

    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.collecting"

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Export a sum alias

      TECHNICAL — the review hand-edited `src/calc.ts` with a  # gtd-path-exempt: scenario fixture, not a repo file
      `// TODO: also export a sum() alias` comment; add a `sum` export
      alongside `add`.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → re-unwind"

    # re-unwind: the revert applied nothing — the tree is still
    # byte-for-byte the human's hand-edit, the exact shape a failed apply
    # leaves (an @inmem scenario never executes the check script, which makes
    # this the correct way to simulate that failure). The require-revert
    # guard refuses: `src/calc.ts` still differs from the review base's  # gtd-path-exempt: scenario fixture, not a repo file
    # parent (it didn't exist there at all).
    When I run gtd land
    Then it fails
    And stderr contains "gtd land:"
    And stderr contains "src/calc.ts"
    And the last commit subject is "gtd(agent): build.review.collecting → re-unwind"

    # Recovery: the human (or a re-run of the script) hand-reverts the path —
    # the guard re-establishes the fact from the tree itself, so it does not
    # care how the revert happened. The process advances exactly as the clean
    # case does — the property a marker-file design could not have offered,
    # since a marker would stay wedged from the first, refused attempt.
    Given the file "src/calc.ts" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → design.triage"
    And "src/calc.ts" does not exist
    And ".gtd/REQUIREMENTS.md" exists

  @inmem
  Scenario: a non-actionable review round (an approving remark, no code edit) short-circuits straight to sign-off
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add greeting" that adds "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    # await-review: a note is still feedback-shaped from the flow's own
    # point of view (any REVIEW.md edit beyond a tick), even though it's just
    # an approving remark
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function — nice work, looks great
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.triage"

    # triage: landed untouched, with no verdict — a skipped judgment treats
    # every note as an `edit`, so it still goes to closing, then collecting.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.closing"

    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.collecting"

    # build.review.collecting: JUDGES the round NON-actionable (only an
    # approving remark) — changes nothing -> straight to sign-off, landing
    # directly in `idle` (the process boundary), no design lap for nothing
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → idle"
    And ".gtd/REQUIREMENTS.md" does not exist
    And the git status is clean
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"idle\":true"

  @live
  Scenario: re-unwind actually reverts a hand-edited code line, never resurrects the review file, and leaves the state dir alone
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add thing" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk
      - [ ] ./src/thing.ts#1
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given "src/thing.ts" is modified to:
      """
      export const thing = 1
      // TODO: also export doubled
      """
    And a file ".gtd/marker.md" with:
      """
      keep this — under .gtd/, must survive the revert
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → build.review.collecting"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Export doubled
      """
    And gtd lands "gtd(agent): build.review.collecting → re-unwind"
    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → design.triage"
    And "src/thing.ts" does not contain "TODO"
    And ".gtd/REVIEW.md" does not exist
    And ".gtd/marker.md" exists

  @live
  Scenario: re-unwind on a note-only review round reverts nothing and still advances to design.triage
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add thing" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk
      - [ ] ./src/thing.ts#1
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk
      - [x] ./src/thing.ts#1
      looks great, nice work
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.triage"
    And gtd lands "gtd(judge): build.review.triage → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → build.review.collecting"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Export doubled
      """
    And gtd lands "gtd(agent): build.review.collecting → re-unwind"
    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → design.triage"
    And the git status is clean

  @live
  Scenario: a revert that cannot apply is refused, not silently swallowed
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add thing" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk
      - [ ] ./src/thing.ts#1
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given "src/thing.ts" is modified to:
      """
      export const thing = 1
      // TODO: also export doubled
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → build.review.collecting"
    # The collecting → re-unwind commit ALSO rewrites the exact line the
    # human's own commit touched, so re-unwind must not overwrite it: it
    # leaves the path alone and the tree clean — indistinguishable from a
    # legitimate note-only round without the require-revert check.
    Given "src/thing.ts" is modified to:
      """
      export const thing = 1
      // TODO: something else entirely landed here first
      """
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Export doubled
      """
    And gtd lands "gtd(agent): build.review.collecting → re-unwind"
    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it fails
    And stderr contains "gtd land:"
    And stderr contains "src/thing.ts"
    And the last commit subject is "gtd(agent): build.review.collecting → re-unwind"

  @inmem
  Scenario: writing the bundled sketch file alone starts a process — idle's file: hint is the same nested path its edge pattern already covers
    Given a test project
    And the workflow
    # idle's edge pattern is "* **" — a lone `*` never crosses a `/`, so only
    # the "**" half reaches into ".gtd/" at all. A future narrowing to "* *"
    # would leave this sketch unmatched and idle would refuse it.
    And a file ".gtd/TODO.md" with:
      """
      - [ ] sketch: add a greeter
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"

  @inmem
  Scenario: the design gate refuses an unanswered open question, then ticking loops back to triage
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    # answerGate: stepping with no tick is refused, even though something
    # else in the doc changed — a dirty tree that still leaves the question
    # unanswered, not a no-op on an untouched one
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a widget. Also needs auth.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    When I run gtd land
    Then it fails
    And stderr contains "not answered"
    And stderr contains "Which storage backend?"
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

  @inmem
  Scenario: the accept-all escape — deleting the whole Open Questions section is allowed and loops to triage to finalize
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite
      - [ ] Postgres
      - [ ] _your answer_
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    # delete the whole Open Questions section — accept-all, no unanswered question remains
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a widget.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → design.triage"

  @inmem
  Scenario: a ticked free-text slot with text is a valid answer at the technical gate; the placeholder alone is refused
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Widget

      Build a widget.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Modules: widget.ts, store.ts.

      ## Open Questions

      ### ORM or raw SQL?

      - [ ] Prisma
      - [ ] raw SQL
      - [ ] _your answer_
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    # free-text slot ticked but still the placeholder -> refused (a real dirty
    # edit — ticking the box — that still leaves the question unanswered)
    Given ".gtd/ARCHITECTURE.md" is modified to:
      """
      Modules: widget.ts, store.ts.

      ## Open Questions

      ### ORM or raw SQL?

      - [ ] Prisma
      - [ ] raw SQL
      - [x] _your answer_
      """
    When I run gtd land
    Then it fails
    And stderr contains "not answered"
    Given ".gtd/ARCHITECTURE.md" is modified to:
      """
      Modules: widget.ts, store.ts.

      ## Open Questions

      ### ORM or raw SQL?

      - [ ] Prisma
      - [ ] raw SQL
      - [x] Drizzle — typed, lightweight
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): architecture.gate.answer → architecture.author"

  @inmem
  Scenario: two consecutive open-questions rounds both rest at the gate — the flow re-reads the steering file after every triage turn
    # Whether design.triage rests at design.gate.answer is read from
    # .gtd/REQUIREMENTS.md itself after each triage turn, not from a marker a
    # previous round left behind: a second round that raises a DIFFERENT open
    # question must stop at the gate again, never fall through to
    # architecture-pre with a question still open.
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.answer"

    # Round 1's question is answered in full (satisfying the answer gate),
    # looping back to design.triage.
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a widget.

      ## Answered Questions

      ### Which storage backend?

      SQLite — zero-config, file-based.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → design.triage"

    # design.triage folds the answer in but raises a DIFFERENT open question —
    # the phase still has open questions, just not the same one.
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a widget. Storage: SQLite.

      ## Open Questions

      ### Which cache eviction policy?

      - [ ] LRU
      - [ ] TTL
      - [ ] _your answer_
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.answer"

  @inmem
  Scenario: a self-answered question in ## Answered Questions never stops the process at design.gate.answer
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a greet() export returning a friendly string.

      ## Answered Questions

      ### Which storage backend?

      SQLite — no concurrent writers, a confident default.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.answer"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → architecture-pre"
    And the git log does not contain "Gtd-Judge:"
    And ".gtd/ASSUMPTIONS.md" does not exist

  @inmem
  Scenario: a hand-edited code change does not survive the unwind; its concern is folded into REQUIREMENTS.md instead
    Given a test project
    And the workflow
    And a file "src/real.ts" with:
      """
      export const real = 1
      """
    And a file "SCRATCH.md" with:
      """
      idea: also expose a helper that doubles real
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"

    # Simulate the unwind's revert — @inmem never executes
    # scripts — by reverting the working tree to the start commit ourselves:
    # BOTH the scratch note and the hand-edited real code change go, alike.
    Given the file "src/real.ts" is deleted
    And the file "SCRATCH.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → start-gate.check"
    And "src/real.ts" does not exist
    And "SCRATCH.md" does not exist

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"

    # design.triage folds EVERYTHING the entry commit added into
    # REQUIREMENTS.md — the scratch note and the hand-edited real.ts alike —
    # since the unwind already emptied the tree of both; nothing needs
    # deleting here any more.
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Real export

      Add a `real` export. Also expose a helper that doubles it (folded in
      from the human's scratch note).
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.answer"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → architecture-pre"
    And "SCRATCH.md" does not exist
    And "src/real.ts" does not exist

    # Neither piece resurfaces on later laps — both are gone for good, long
    # before anything could reach review sign-off. architecture-pre: no
    # verdict piped -> the conservative default runs the full architecture
    # pass.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): architecture-pre → architecture.author"
    And "SCRATCH.md" does not exist
    And "src/real.ts" does not exist

  @inmem
  Scenario: the handover — architecture.author works from REQUIREMENTS.md alone, a cold read with no assumption of a prior design conversation
    Given a test project
    And the workflow
    # The prompt tells the author to work from REQUIREMENTS.md alone, even
    # though design's own turns sit right there in the history.
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export returning a friendly string. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    When I run gtd next
    Then it succeeds
    And stdout contains "You do not resume the design conversation"

    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: src/greeter.ts exports `greet`, no dependencies.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): architecture.author → architecture.gate.answer"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): architecture.gate.answer → architecture.decompose"
    And ".gtd/REQUIREMENTS.md" does not exist
    And ".gtd/ARCHITECTURE.md" exists

  @inmem
  Scenario: a question must clear the three-part bar, or the planner decides it itself
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    When I run gtd next
    Then it succeeds
    And stdout contains "held back for a later lap is a bug"

    # architecture.author's copy of the bar must be the byte-identical
    # criteria — this identical-string assertion is the only guard against
    # the two inlined copies drifting apart.
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export returning a friendly string. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    When I run gtd next
    Then it succeeds
    And stdout contains "held back for a later lap is a bug"

  @inmem
  Scenario: a package whose work already landed closes out via .gtd/SATISFIED.md
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Widget factory

      Add a widget factory.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: src/widget.ts exports a factory.
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    And gtd lands "gtd(human): architecture.gate.answer → architecture.decompose"
    And the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory. Independent tasks:
      - [ ] add src/widget.ts
      """
    And gtd lands "gtd(agent): architecture.decompose → packages.item.building"

    Given a file ".gtd/SATISFIED.md" with:
      """
      - [x] add src/widget.ts — already present, see commit
        "gtd(agent): architecture.decompose → packages.item.building"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building → packages.item.health.check"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.health.check → packages.item.spec.pre"

    # spec.pre: a skipped judgment (bare land) always runs the
    # full review — this package has no `## ` sections at all anyway
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): packages.item.spec.pre → packages.item.spec.review"

    # packages.item.spec.review (clean = approval — the reviewer's own range
    # is process-wide, so it can see the earlier package's commit that
    # satisfied this spec) -> packages.item.closing
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.closing"

    # packages.item.closing removes the package and its SATISFIED.md; the
    # queue is now empty — on to the quality lap, which fronts the shared
    # review tail
    Given the file ".gtd/packages/01-widget.md" is deleted
    And the file ".gtd/SATISFIED.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.closing → build.quality.reviewing"

  @inmem
  Scenario: a dead-ended package stalls, then a human's .gtd/SATISFIED.md unsticks it
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Widget factory

      Add a widget factory.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: src/widget.ts exports a factory.
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    And gtd lands "gtd(human): architecture.gate.answer → architecture.decompose"
    And the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory. Independent tasks:
      - [ ] add src/widget.ts
      """
    And gtd lands "gtd(agent): architecture.decompose → packages.item.building"

    # packages.item.building: the agent's turn changes nothing (the issue's
    # regression case) — a clean tree at a prompt rest with no "C" row lands
    # an empty attempt instead of implementing anything
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building"
    And the git status is clean
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"kind\":\"stalled\""
    And the json field "content" contains "stalled at \"packages.item.building\""

    # the supported recovery: a human writes the satisfied evidence
    # themselves and runs gtd land — no hand-authored state commit
    Given a file ".gtd/SATISFIED.md" with:
      """
      - [x] add src/widget.ts — already present, see commit
        "gtd(agent): architecture.decompose → packages.item.building"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building → packages.item.health.check"

  @inmem
  Scenario: a feedback round's reviewing base is anchored at the last review round (incremental it.reviewBase)
    # A feedback round's commit (the human's await-review landing) becomes
    # the base of the re-planned lap: a re-review's range starts only from
    # the previous review round's boundary, not the whole process. fileA landed
    # before that boundary; fileB after it, on the re-planned lap.
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add fileA.ts" that adds "fileA.ts" with:
      """
      export const A = 1
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: aaaaaaa
      <!-- base: 0000000 -->

      ## A
      - [ ] ./fileA.ts#1
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    And "fileA.ts" is modified to:
      """
      export const A = 1
      // also add B
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And I mark the current commit as "review-round-1"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → build.review.collecting"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Add B

      Also export a `B` constant.
      """
    And gtd lands "gtd(agent): build.review.collecting → re-unwind"
    And "fileA.ts" is modified to:
      """
      export const A = 1
      """
    And gtd lands "gtd(check): re-unwind → design.triage"
    And ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Add B

      Export a `B` constant from fileB.ts.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: fileB.ts exports `B`.
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    And gtd lands "gtd(human): architecture.gate.answer → architecture.decompose"
    And the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-b.md" with:
      """
      Package: export B.
      - [ ] add fileB.ts
      """
    And gtd lands "gtd(agent): architecture.decompose → packages.item.building"
    And a file "fileB.ts" with:
      """
      export const B = 2
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    And gtd lands "gtd(judge): packages.item.spec.pre → packages.item.spec.review"
    And gtd lands "gtd(agent): packages.item.spec.review → packages.item.closing"
    And the file ".gtd/packages/01-b.md" is deleted
    And gtd lands "gtd(check): packages.item.closing → build.review.reviewing"
    When I run gtd next
    Then it succeeds
    # The reviewing prompt names it.reviewBase — the previous review round's
    # boundary — not fileA/fileB directly; no diff content is ever inlined.
    And stdout contains the hash of "review-round-1"

  @inmem
  Scenario: a green check run that also cleans up leftover feedback moves on to reviewing with no residue (D .gtd/FEEDBACK.md)
    Given a test project
    And the workflow
    # No quality lenses, so a green health check hands straight to the human
    # review tail — the quality lap itself is covered in its own feature.
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"
    And ".gtd/FEEDBACK.md" does not exist

  @inmem
  Scenario: repeated check failures escalate once fixing's retry cap (3) is reached, writing a fix-design document a human can edit before the next fix turn
    Given a test project
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 1 failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file ".gtd/fix-1.md" with:
      """
      fixed attempt 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 2 failed
      """
    And gtd lands "gtd(check): build.health.check → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file ".gtd/fix-2.md" with:
      """
      fixed attempt 2
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 3 failed
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    And gtd lands "gtd(judge): build.health.judge → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file ".gtd/fix-3.md" with:
      """
      fixed attempt 3
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 4 failed
      """
    # A red round after the first is judged before the cap is consulted; a
    # skipped judgment leaves the cap to decide.
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): build.health.judge → build.health.describe"
    When I run gtd next
    Then it succeeds
    And stdout contains ".gtd/FEEDBACK.md"
    And stdout contains "git log -p -- .gtd/FEEDBACK.md"
    And stdout contains ".gtd/ESCALATION.md"
    Given a file ".gtd/ESCALATION.md" with:
      """
      What's failing: the suite still reports "attempt 4 failed" after three
      fix attempts.

      Why earlier attempts didn't resolve it: fix-1/fix-2/fix-3 each patched
      a symptom, not the root cause.

      Suggested approach: rewrite the failing test's setup fixture instead
      of touching the assertion again.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.health.describe → build.health.stop"
    And ".gtd/ESCALATION.md" contains "What's failing: the suite still reports"
    When I run gtd next
    Then it succeeds
    And stdout contains ".gtd/ESCALATION.md"
    And stdout contains "Edit it"
    # The human takes the stop gate's own edge straight into build.fix — no
    # detour back through build.health.check first.
    Given a file ".gtd/marker2.md" with:
      """
      landing the escalation document as the next fix turn's instruction
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.health.stop → build.fix"
    When I run gtd next
    Then it succeeds
    # The fix prompt names .gtd/ESCALATION.md as the primary instruction
    # whenever it is present.
    And stdout contains ".gtd/ESCALATION.md"
    Given a file "src/thing.ts" with:
      """
      export const thing = 2
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"
    # A second red run: if the fix budget were not reset by the escalation
    # round, this would already be over the cap and bounce straight back to
    # an escalation. Reaching build.fix instead is the proof the
    # escalation round genuinely restored it.
    Given a file ".gtd/FEEDBACK.md" with:
      """
      attempt 5 failed
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): build.health.judge → build.fix"

  @inmem
  Scenario: landing build.health.stop with a clean tree still hands the document to the next fix turn, and editing ESCALATION.md there does not spend a second escalation round
    Given a test project
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the suite fails in the setup fixture
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the suite fails in the setup fixture, again
      """
    And gtd lands "gtd(check): build.health.check → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 2
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the suite fails in the setup fixture, again
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    When I run gtd judge answer with stdin:
      """
      [{"id":"verdict","answer":"identical","p":0.99}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.health.judge → build.health.describe"
    Given a file ".gtd/ESCALATION.md" with:
      """
      Round 1: the suite fails inside the same setup fixture every attempt.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.health.describe → build.health.stop"

    # The human EDITS the document at `stop` — the primary action its own
    # message asks for ("Edit it — narrow it, redirect it, add what you
    # know") — rather than landing an unrelated marker file. This commit is
    # an M .gtd/ESCALATION.md, same shape as `describe`'s own A/M, but it
    # must not be mistaken for a second escalation round.
    Given a file ".gtd/ESCALATION.md" with:
      """
      Round 1, human-narrowed: the fixture leaks state between the second
      and third assertion — look at teardown, not setup.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.health.stop → build.fix"

    # A real fix turn, still red — back to health.check, then to escalate
    # for what is genuinely only the SECOND round (the human's own edit
    # above must not have counted as one).
    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 3
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"
    # Reach a second arrival at escalate the short way — a judged
    # "identical" red round — rather than re-driving the fix cap's count,
    # which is unrelated to what this scenario pins.
    Given a file ".gtd/FEEDBACK.md" with:
      """
      the fixture still leaks state
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    # If the human's edit at `stop` had counted as a round, this would see 2
    # prior rounds already and land straight at the terminal `exhausted`
    # stop. Reaching `describe` instead is the proof it didn't.
    When I run gtd judge answer with stdin:
      """
      [{"id":"verdict","answer":"identical","p":0.99}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.health.judge → build.health.describe"

  @inmem
  Scenario: landing build.health.stop with a genuinely clean tree still advances to build.fix — "land it untouched" as its message promises
    Given a test project
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the suite fails in the setup fixture
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the suite fails in the setup fixture, again
      """
    And gtd lands "gtd(check): build.health.check → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 2
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the suite fails in the setup fixture, again
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    When I run gtd judge answer with stdin:
      """
      [{"id":"verdict","answer":"identical","p":0.99}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.health.judge → build.health.describe"
    Given a file ".gtd/ESCALATION.md" with:
      """
      Round 1: the suite fails inside the same setup fixture every attempt.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.health.describe → build.health.stop"

    # A genuinely clean land — no edit, no unrelated marker — still hands
    # the document to build.fix via stop's own "C" row.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.health.stop → build.fix"

  @inmem
  Scenario: a second full escalation round rests at the terminal exhausted stop — no third document is written, and .gtd/ESCALATION.md stays on disk
    Given a test project
    And the workflow
    # Round 1: the first escalation since the last green check routes on to
    # describe.
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the suite fails in the setup fixture
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the suite fails in the setup fixture, again
      """
    And gtd lands "gtd(check): build.health.check → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 2
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the suite fails in the setup fixture, again
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    When I run gtd judge answer with stdin:
      """
      [{"id":"verdict","answer":"identical","p":0.99}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.health.judge → build.health.describe"
    Given a file ".gtd/ESCALATION.md" with:
      """
      Round 1: the suite fails inside the same setup fixture every attempt.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.health.describe → build.health.stop"
    Given a file ".gtd/marker2.md" with:
      """
      landing round 1's document untouched
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.health.stop → build.fix"

    # A real fix turn between round 1 and round 2: it believes it resolved
    # the check and deletes `.gtd/FEEDBACK.md` (the fix prompt's own
    # instruction), but `.gtd/ESCALATION.md` survives untouched — the SAME
    # prompt tells the turn to never edit or delete it, only a genuinely
    # green check does that. The next check is still red and rewrites
    # `.gtd/FEEDBACK.md` from scratch.
    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 3
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"
    Given a file ".gtd/FEEDBACK.md" with:
      """
      attempt 5 failed
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): build.health.judge → build.fix"
    And ".gtd/ESCALATION.md" contains "Round 1: the suite fails"

    # Round 2: back at the same red check, escalating again — still under 2
    # prior rounds (round 1's own add is the only one so far), so the script
    # again leaves the tree clean and routes on to describe rather than the
    # terminal stop.
    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 4
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the same fixture failure, restated
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    When I run gtd judge answer with stdin:
      """
      [{"id":"verdict","answer":"identical","p":0.99}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.health.judge → build.health.describe"
    # Round 2's describe OVERWRITES round 1's still-surviving document — an
    # M, not an A, since nothing ever swept it in between.
    Given a file ".gtd/ESCALATION.md" with:
      """
      Round 2: still the same fixture, now with a different failing assertion.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.health.describe → build.health.stop"
    Given a file ".gtd/marker4.md" with:
      """
      landing round 2's document untouched
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.health.stop → build.fix"

    # Another real fix turn between round 2 and round 3 — same shape as
    # above: FEEDBACK.md churns, ESCALATION.md survives untouched.
    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing2.ts" with:
      """
      export const thing2 = 4
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"
    Given a file ".gtd/FEEDBACK.md" with:
      """
      attempt 6 failed
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): build.health.judge → build.fix"
    And ".gtd/ESCALATION.md" contains "Round 2: still the same fixture"

    # Round 3: the cap. Two prior `.gtd/ESCALATION.md` rounds are already on
    # record since the last green check (round 1's add, round 2's modify —
    # health.check's own sweep only ever runs on a green result, so neither
    # was ever deleted along the way), so the round-counting script stamps
    # round 2's own surviving content in place instead of routing to describe
    # for a third — stamped with HEAD so it still registers as a real edit
    # (an M, the file never having been swept) even though the content is
    # otherwise unchanged. It restores from history only when the file is
    # missing, which it isn't here.
    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 5
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      the same fixture failure, restated
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    Given a file ".gtd/ESCALATION.md" with:
      """
      Round 2: still the same fixture, now with a different failing assertion.
      """
    When I run gtd judge answer with stdin:
      """
      [{"id":"verdict","answer":"identical","p":0.99}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.health.judge → build.health.exhausted"
    And ".gtd/ESCALATION.md" contains "Round 2: still the same fixture"
    And ".gtd/ESCALATION.md" does not contain "Round 1: the suite fails"
    When I run gtd next
    Then it succeeds
    And stdout contains "exhausted"
    And stdout contains ".gtd/ESCALATION.md"
    And stdout contains ".gtd/FEEDBACK.md"

    # Landing the terminal exhausted stop with a genuinely clean tree still
    # buys another attempt at the same analysis, exactly as its message
    # promises — the "C" row, not just "* **", is what makes that true.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.health.exhausted → build.fix"

  @inmem
  Scenario: deleting REVIEW.md at await-review is refused — sign off by leaving no comment, not by deleting
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add src/thing.ts" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/thing.ts#1
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given I record the commit count
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it fails
    And stderr contains "was deleted"
    # Nothing committed, and a refusal emits no script at all — the process
    # stays at the gate for the reviewer to restore + tick.
    And the commit count is unchanged

  @live
  Scenario: gtd next at await-review leaves HEAD untouched and writes no worktree ref
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add src/thing.ts" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/thing.ts#1
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given I mark the current commit as "before"
    When I run gtd next
    Then it succeeds
    And the current commit is the same as "before"
    And no ref under "refs/worktree/gtd/" was created

  @inmem
  Scenario: a sign-off lands even with a box still unticked — a tick only records that a hunk was read
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add src/thing.ts" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/a.ts#1
      - [ ] ./src/b.ts#1
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [x] ./src/a.ts#1
      - [ ] ./src/b.ts#1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → idle"

  @inmem
  Scenario: at await-review, gtd next surfaces the sign-off vs. feedback contract in its human-gate message
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add src/thing.ts" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/thing.ts#1
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    When I run gtd next
    Then it succeeds
    And stdout contains "**Sign off** — leave no comment"
    And stdout contains "**Leave notes** — a note on a"
    And stdout contains "Deleting `.gtd/REVIEW.md` is refused."

  @inmem
  Scenario: a code edit at await-review is feedback — once the review closes it goes to collecting (which turns it into a re-planned round)
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add src/thing.ts" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/thing.ts#1
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given a file "src/extra.ts" with:
      """
      export const extra = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.collecting"

  @inmem
  Scenario: an ordinary sign-off commit into idle is a process boundary — a fresh process's fixing retry budget doesn't pool with a previous process's
    Given a test project
    And the workflow
    # cycle 1: spends its whole fixing retry budget (3 fix turns) before a
    # clean review sign-off ends the process at `idle` — the episode
    # boundary a fresh process's replay starts after.
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      cycle 1 attempt 1 failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file ".gtd/fix-1.md" with:
      """
      fixed cycle 1 attempt 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      cycle 1 attempt 2 failed
      """
    And gtd lands "gtd(check): build.health.check → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file ".gtd/fix-2.md" with:
      """
      fixed cycle 1 attempt 2
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      cycle 1 attempt 3 failed
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    And gtd lands "gtd(judge): build.health.judge → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file ".gtd/fix-3.md" with:
      """
      fixed cycle 1 attempt 3
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Fixes
      - [ ] ./.gtd/fix-3.md#1
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Fixes
      - [x] ./.gtd/fix-3.md#1
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → idle"
    # cycle 2 starts fresh after the sign-off boundary. If fix counts pooled
    # across it, this process's very first red check would already be over
    # the cap and escalate instead of fixing.
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      cycle 2 precheck failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/cycle2.ts" with:
      """
      export const cycle2 = 2
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    Given a file ".gtd/FEEDBACK.md" with:
      """
      cycle 2 attempt 1 failed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.fix"

  @inmem
  Scenario: each machine's own agent states compute a memory key from their owning machine-instance scope
    # Memory is COMPUTED from each step's enclosing scope plus a
    # commit-anchored hash — there is no authored `memory:` label.
    # design/architecture are sibling scopes; packages.item's own scope is
    # "packages.item"; build/build.review are "build"/"build.review".
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "start"
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And stdout matches "\"memory\":\"design#[0-9a-f]{7}\""
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"architecture.author\""
    And stdout matches "\"memory\":\"architecture#[0-9a-f]{7}\""
    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: src/thing.ts.
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    And gtd lands "gtd(human): architecture.gate.answer → architecture.decompose"
    And the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-thing.md" with:
      """
      Package: the thing.
      - [ ] add src/thing.ts
      """
    And gtd lands "gtd(agent): architecture.decompose → packages.item.building"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.building\""
    And stdout matches "\"memory\":\"packages\.item#[0-9a-f]{7}\""
    # build.* is entered through its own entry, off a fresh history.
    Given I hard-reset to "start"
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      a failing test
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And stdout matches "\"memory\":\"build#[0-9a-f]{7}\""
    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing2.ts" with:
      """
      export const thing2 = 2
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.review.reviewing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And stdout matches "\"memory\":\"build\.review#[0-9a-f]{7}\""

  @inmem
  Scenario: a custom two-level nested machine reference resolves $param bindings and qualified names across both levels
    Given a test project
    # A scope nested inside a scope qualifies its steps with both prefixes;
    # a flow fragment's "where to go when done" is just the code after it.
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, scope } from "@pmelab/gtd/flows"

      const leaf = () => scope("inner", () => agent("work", "do the work"))

      const mid = async () => {
        await human("gate", { message: "approve?" })
        await leaf()
      }

      export default async () => {
        await human("idle", { message: "start" })
        await scope("nested", mid)
        await human("done", { message: "done" })
      }
      """
    And a file "NOTE.md" with:
      """
      kick off
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → nested.gate"

    # idle -> mid's first step (nested.gate); this step resolves ONE level
    # deeper still, into leaf's own scope (nested.inner.work) — a two-level
    # qualified name.
    Given a file "NOTE.md" with:
      """
      approved
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): nested.gate → nested.inner.work"
    When I run gtd next
    Then it succeeds
    And stdout contains "do the work"

    # leaf returns, then mid returns, and the root flow carries on to its
    # own "done" step two levels up.
    Given a file "NOTE.md" with:
      """
      done
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): nested.inner.work → done"
