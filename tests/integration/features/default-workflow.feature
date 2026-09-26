Feature: The bundled unified workflow — one flow, end to end

  `src/workflows/unified.yaml` is ONE flow now: `idle` has exactly one outgoing
  edge, into `unwind` — ANY change at all (a hand-edit to real code, a scratch
  note, or both) is a SKETCH, reverted out of the working tree by `unwind`
  before `start-gate.check` (the green-baseline gate) ever runs. There is no
  more fork on which steering file the human happened to create. Once
  green, `design.triage` groups the diff into ordered, classified concerns and
  raises PRODUCT open questions; `design.gate` (a shared check+answer pair)
  rests the process at a human gate only while some remain — a question-free
  phase skips the human stop entirely and falls straight through to
  `architecture.author`, a COLD reader that never resumes design's
  conversation. `architecture.gate` mirrors the same shape for TECHNICAL
  questions, then `architecture.decompose` mechanically writes one package
  file per concern. From there the per-package build queue (`packages.*`) and
  the shared review tail (`build.*`) are unchanged: health/fix, per-package
  spec review, and the human review gate's sign-off-vs-feedback arbiter — a
  clean sign-off lands an ordinary commit straight into `idle`, retaining
  every prior per-turn commit on the branch; `gtd summary` afterward prints a
  closing-message prompt.

  Every `check`-actor state here (`start-gate.check`, `design.gate.check`,
  `architecture.gate.check`, `packages.picking`, `packages.item.health.check`,
  `packages.item.closing`, `build.health.check`, `build.review.deciding`) is
  simulated on the `@inmem` scenarios below by writing its verdict file
  directly and running `gtd land` — `@inmem` never executes the scripts
  themselves. Two scenarios actually need the real shell script
  (`design.gate.check`'s HEAD-stamping mechanic, and `re-unwind`'s scoped
  revert) and are tagged `@live`, running it for real via "I execute the
  printed check script".

  @inmem
  Scenario: an ordinary code change starts the process — triage, both gates skip when question-free, one package built/fixed/reviewed, then a clean review sign-off lands directly into idle
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

    # unwind: simulate the `git revert --no-commit` — @inmem never executes
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
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.check"

    # design.gate.check: the probe finds no open questions (simulated by never
    # creating .gtd/QUESTIONS.md) — a clean step matches "C", skipping
    # straight to architecture-pre with NO human stop at design.gate.answer
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.check → architecture-pre"

    # architecture-pre: no verdict piped -> the conservative default runs
    # the full architecture pass, same as any other skipped judgment.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): architecture-pre → architecture.author"

    # architecture.author: a COLD read of REQUIREMENTS.md — develops the how,
    # deletes the requirements file once folded in
    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: src/greeter.ts exports `greet`, no dependencies.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): architecture.author → architecture.gate.check"

    # architecture.gate.check: again no open technical questions -> straight
    # to decompose, no human stop at architecture.gate.answer either
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): architecture.gate.check → architecture.decompose"
    And the git log does not contain "design.gate.answer"
    And the git log does not contain "architecture.gate.answer"

    Given the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-greeting.md" with:
      """
      Package: the greeting export. Independent tasks:
      - [ ] add src/greeter.ts exporting `greet`
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): architecture.decompose → packages.picking"

    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-greeting.md
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.picking → packages.item.building"

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
    And the last commit subject is "gtd(judge): packages.item.spec.pre → packages.item.spec.scoping"

    # spec.scoping: no Gtd-Judge trailer on HEAD -> nothing to scope, straight
    # through to the reviewer
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.spec.scoping → packages.item.spec.review"

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
    And the last commit subject is "gtd(judge): packages.item.spec.pre → packages.item.spec.scoping"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.spec.scoping → packages.item.spec.review"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.closing"

    Given the file ".gtd/packages/01-greeting.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.closing → packages.picking"

    # packages.picking: the queue is now drained -> the quality lap, which
    # every ordinary round pays for once, after the last package and before
    # any human sees the change. The per-package review above judged that
    # package's own spec coverage only; these lenses judge the code.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.picking → build.quality.seeding"

    # seeding writes one padded file per bundled qualityReviews entry.
    Given a file ".gtd/reviews/01-owasp-security.md" with:
      """
      owasp-security
      """
    And a file ".gtd/reviews/02-code-simplification.md" with:
      """
      code-simplification
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.seeding → build.quality.picking"

    Given a file ".gtd/NEXT_REVIEW.md" with:
      """
      owasp-security
      """
    And the file ".gtd/reviews/01-owasp-security.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.picking → build.quality.reviewing"

    # A clean lens turn — nothing blocking, so no .gtd/QUALITY.md.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing → build.quality.picking"

    Given a file ".gtd/NEXT_REVIEW.md" with:
      """
      code-simplification
      """
    And the file ".gtd/reviews/02-code-simplification.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.picking → build.quality.reviewing"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing → build.quality.picking"

    # The lap is drained with no findings -> straight on to human review.
    Given the file ".gtd/NEXT_REVIEW.md" is deleted
    And a file ".gtd/QUALITY_DONE.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.picking → build.review.reviewing"
    And ".gtd/QUALITY_READY.md" does not exist

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
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → idle"
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
      gtd(agent): design.triage → design.gate.check
      gtd(check): design.gate.check → architecture-pre
      gtd(judge): architecture-pre → architecture.author
      gtd(agent): architecture.author → architecture.gate.check
      gtd(check): architecture.gate.check → architecture.decompose
      gtd(agent): architecture.decompose → packages.picking
      gtd(check): packages.picking → packages.item.building
      gtd(agent): packages.item.building → packages.item.health.check
      gtd(check): packages.item.health.check → packages.item.fix-suite
      gtd(agent): packages.item.fix-suite → packages.item.health.check
      gtd(check): packages.item.health.check → packages.item.spec.pre
      gtd(judge): packages.item.spec.pre → packages.item.spec.scoping
      gtd(check): packages.item.spec.scoping → packages.item.spec.review
      gtd(agent): packages.item.spec.review → packages.item.fix-spec
      gtd(agent): packages.item.fix-spec → packages.item.health.check
      gtd(check): packages.item.health.check → packages.item.spec.pre
      gtd(judge): packages.item.spec.pre → packages.item.spec.scoping
      gtd(check): packages.item.spec.scoping → packages.item.spec.review
      gtd(agent): packages.item.spec.review → packages.item.closing
      gtd(check): packages.item.closing → packages.picking
      gtd(check): packages.picking → build.quality.seeding
      gtd(check): build.quality.seeding → build.quality.picking
      gtd(check): build.quality.picking → build.quality.reviewing
      gtd(agent): build.quality.reviewing → build.quality.picking
      gtd(check): build.quality.picking → build.quality.reviewing
      gtd(agent): build.quality.reviewing → build.quality.picking
      gtd(check): build.quality.picking → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.await-review
      gtd(human): build.review.await-review → build.review.deciding
      gtd(check): build.review.deciding → idle
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
    And gtd lands "gtd(check): review-gate.check → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
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
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

    # build.review.deciding: CAPTURES the raw material (never interprets it),
    # removes REVIEW.md
    Given a file ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      Commit: deadbeef
      """
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.collecting"

    # build.review.collecting: JUDGES the round actionable — a hand-edit to
    # real code — and CLASSIFIES it straight into REQUIREMENTS.md (never an
    # instruction list for a builder), then consumes the raw capture -> the
    # root's own re-unwind
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Export a sum alias

      TECHNICAL — the review hand-edited `src/calc.ts` with a  # gtd-path-exempt: scenario fixture, not a repo file
      `// TODO: also export a sum() alias` comment; add a `sum` export
      alongside `add`.
      """
    And the file ".gtd/REVIEW_RAW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → re-unwind"
    And ".gtd/REVIEW_RAW.md" does not exist

    # re-unwind: simulate the scoped `git apply -R` — @inmem never executes
    # scripts — by reverting the human's hand-edit ourselves. The human's own
    # commit ADDED src/calc.ts, so a real reverse-apply of it DELETES the  # gtd-path-exempt: scenario fixture, not a repo file
    # file, not merely rewrites its content. The human's intent survives only
    # in their own "await-review → deciding" commit, for design.triage to
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
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    # await-review: a hand-edit to real code is feedback
    Given a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      // TODO: also export a sum() alias
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

    Given a file ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      Commit: deadbeef
      """
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.collecting"

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Export a sum alias

      TECHNICAL — the review hand-edited `src/calc.ts` with a  # gtd-path-exempt: scenario fixture, not a repo file
      `// TODO: also export a sum() alias` comment; add a `sum` export
      alongside `add`.
      """
    And the file ".gtd/REVIEW_RAW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → re-unwind"

    # re-unwind: `git apply -R` failed and applied nothing — the tree is still
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
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    # await-review: a note is still feedback-shaped from deciding's own
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
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

    # build.review.deciding: a note-only round is a JUDGMENT call, not a
    # fact — leaves REVIEW.md in place and writes the REVIEW_NOTE.md signal
    # for `triage`'s own noul.
    Given a file ".gtd/REVIEW_NOTE.md" with:
      """
      This is machine-captured input, not instructions. A downstream judgment decides actionability.

      Commit: deadbeef
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.triage"

    # triage: landed untouched, with no verdict — the conservative default
    # runs the full triage.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.triaging"

    # triaging: a skipped judgment defaults every chunk to actionable, so it
    # still captures the raw material and hands off to collecting.
    Given a file ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      Commit: deadbeef
      """
    And the file ".gtd/REVIEW.md" is deleted
    And the file ".gtd/REVIEW_NOTE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.triaging → build.review.collecting"

    # build.review.collecting: JUDGES the round NON-actionable (only an
    # approving remark) — CONSUMES the raw capture (deletes it, the only
    # change this turn) -> straight to sign-off, landing directly in `idle`
    # (the process boundary), no design lap for nothing, and nothing left
    # over to leak into a later `gtd summary` call
    Given the file ".gtd/REVIEW_RAW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → idle"
    And ".gtd/REVIEW_RAW.md" does not exist
    And ".gtd/REQUIREMENTS.md" does not exist
    And the git status is clean
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"idle\":true"

  @live
  Scenario: re-unwind actually reverts a hand-edited code line, never resurrects the review file, and leaves the state dir alone
    Given a test project
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And the working tree is committed as "gtd(agent): build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk
      - [ ] ./src/thing.ts#1
      """
    And the working tree is committed as "gtd(check): build.review.reviewing → build.review.await-review"
    Given "src/thing.ts" is modified to:
      """
      export const thing = 1
      // TODO: also export doubled
      """
    And the file ".gtd/REVIEW.md" is deleted
    And a file ".gtd/marker.md" with:
      """
      keep this — under .gtd/, must survive the revert
      """
    And the working tree is committed as "gtd(human): build.review.await-review → build.review.deciding"
    And an empty commit "gtd(agent): build.review.collecting → re-unwind"
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
  Scenario: re-unwind on a note-only review round applies no patch (an empty patch is not a valid git apply input) and the C row still advances to design.triage
    Given a test project
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And the working tree is committed as "gtd(agent): build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk
      - [ ] ./src/thing.ts#1
      """
    And the working tree is committed as "gtd(check): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk
      - [x] ./src/thing.ts#1
      looks great, nice work
      """
    And the file ".gtd/REVIEW.md" is deleted
    And the working tree is committed as "gtd(human): build.review.await-review → build.review.deciding"
    And an empty commit "gtd(agent): build.review.collecting → re-unwind"
    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → design.triage"
    And the git status is clean

  @live
  Scenario: a genuinely failing `git apply -R` is refused, not silently swallowed
    Given a test project
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And the working tree is committed as "gtd(agent): build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk
      - [ ] ./src/thing.ts#1
      """
    And the working tree is committed as "gtd(check): build.review.reviewing → build.review.await-review"
    Given "src/thing.ts" is modified to:
      """
      export const thing = 1
      // TODO: also export doubled
      """
    And the file ".gtd/REVIEW.md" is deleted
    And the working tree is committed as "gtd(human): build.review.await-review → build.review.deciding"
    # The collecting → re-unwind commit ALSO rewrites the exact line the
    # human's own commit touched — a rewrite with no shared context, so the
    # reverse-apply of the human's patch has nothing to match. This is the
    # "atomic patch applies nothing" failure the require-revert guard exists
    # to catch: `git apply -R` exits non-zero, the script's own
    # `|| echo … >&2` swallows that into exit 0, and the tree is left clean —
    # indistinguishable from a legitimate note-only round without the guard.
    Given "src/thing.ts" is modified to:
      """
      export const thing = 1
      // TODO: something else entirely landed here first
      """
    And the working tree is committed as "gtd(agent): build.review.collecting → re-unwind"
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
    And a commit "gtd(agent): design.gate.answer" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
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
    And a commit "gtd(agent): design.gate.answer" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite
      - [ ] Postgres
      - [ ] _your answer_
      """
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
    And a commit "gtd(agent): architecture.gate.answer" that adds ".gtd/ARCHITECTURE.md" with:
      """
      Modules: widget.ts, store.ts.

      ## Open Questions

      ### ORM or raw SQL?

      - [ ] Prisma
      - [ ] raw SQL
      - [ ] _your answer_
      """
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

  @live
  Scenario: two consecutive open-questions rounds both rest at the gate — the marker's HEAD stamp regression (design.gate.check)
    # design.gate.check's probe script always writes the SAME fixed sentence
    # into .gtd/QUESTIONS.md regardless of which question is open ("open
    # questions remain in <file>"), stamped with the current HEAD so a repeat
    # open verdict never looks byte-identical to its own last committed copy.
    # Without that stamp, round 2's write would be byte-for-byte identical to
    # round 1's committed marker -> registers as "C" -> wrongly falls through
    # to architecture.author with a question still open. This can only be
    # caught by actually running the real script (@inmem never executes it).
    Given a test project
    And a commit "gtd(agent): design.gate.check" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.check → design.gate.answer"
    And ".gtd/QUESTIONS.md" exists

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
    And the last commit subject is "gtd(agent): design.triage → design.gate.check"

    # Round 2 of the check: HEAD has advanced since round 1's committed
    # marker, so the fresh stamp must differ and land at the gate again —
    # never fall through to architecture-pre.
    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.check → design.gate.answer"

  @inmem
  Scenario: a self-answered question in ## Answered Questions never stops the process at design.gate.answer
    Given a test project
    And the workflow
    And a commit "gtd(agent): design.triage → design.gate.check" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a greet() export returning a friendly string.

      ## Answered Questions

      ### Which storage backend?

      SQLite — no concurrent writers, a confident default.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.check → architecture-pre"
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

    # Simulate the unwind's `git revert --no-commit` — @inmem never executes
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
    And the last commit subject is "gtd(agent): design.triage → design.gate.check"
    And "SCRATCH.md" does not exist
    And "src/real.ts" does not exist

    # Neither piece resurfaces on later laps — both are gone for good, long
    # before anything could reach review sign-off.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.check → architecture-pre"
    And "SCRATCH.md" does not exist
    And "src/real.ts" does not exist

    # architecture-pre: no verdict piped -> the conservative default runs
    # the full architecture pass.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): architecture-pre → architecture.author"

  @inmem
  Scenario: the handover — architecture.author works from REQUIREMENTS.md alone, a cold read with no assumption of a prior design conversation
    Given a test project
    And the workflow
    # Jump straight into architecture.author — no design.triage/design.gate
    # commit anywhere in this history at all.
    And a commit "gtd(check): architecture.author" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export returning a friendly string. No open questions.
      """
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
    And the last commit subject is "gtd(agent): architecture.author → architecture.gate.check"
    And ".gtd/REQUIREMENTS.md" does not exist
    And ".gtd/ARCHITECTURE.md" exists

  @inmem
  Scenario: a question must clear the three-part bar, or the planner decides it itself
    Given a test project
    And the workflow
    And a commit "gtd(check): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export returning a friendly string.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "held back for a later lap is a bug"

    # architecture.author's copy of the bar must be the byte-identical
    # criteria — this identical-string assertion is the only guard against
    # the two inlined copies drifting apart.
    Given a commit "gtd(check): architecture.author" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export returning a friendly string. No open questions.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "held back for a later lap is a bug"

  @inmem
  Scenario: a package whose work already landed closes out via .gtd/SATISFIED.md
    Given a test project
    And the workflow
    And a commit "gtd(agent): packages.picking" that adds ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory. Independent tasks:
      - [ ] add src/widget.ts
      """
    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.picking → packages.item.building"

    Given a file ".gtd/SATISFIED.md" with:
      """
      - [x] add src/widget.ts — already present, see commit
        "gtd(agent): packages.picking → packages.item.building"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building → packages.item.health.check"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.health.check → packages.item.spec.pre"

    # spec.pre/spec.scoping: a skipped judgment (bare land) always runs the
    # full review — this package has no `## ` sections at all anyway
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): packages.item.spec.pre → packages.item.spec.scoping"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.spec.scoping → packages.item.spec.review"

    # packages.item.spec.review (clean = approval — the reviewer's own range
    # is process-wide, so it can see the earlier package's commit that
    # satisfied this spec) -> packages.item.closing
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.closing"

    Given the file ".gtd/packages/01-widget.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    And the file ".gtd/SATISFIED.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.closing → packages.picking"

    # packages.picking: the queue is now empty — a clean step closes out to
    # the quality lap, which fronts the shared review tail
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.picking → build.quality.seeding"

  @inmem
  Scenario: a dead-ended package stalls, then a human's .gtd/SATISFIED.md unsticks it
    Given a test project
    And the workflow
    And a commit "gtd(agent): packages.picking" that adds ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory. Independent tasks:
      - [ ] add src/widget.ts
      """
    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.picking → packages.item.building"

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
        "gtd(agent): packages.picking → packages.item.building"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building → packages.item.health.check"

  @inmem
  Scenario: a feedback round's reviewing base is anchored at the last review round (incremental it.reviewBase)
    # reviewBase: true on build.review.deciding anchors it.reviewBase: a
    # re-review's range starts only from the previous review round's
    # boundary, not the whole process. fileA landed before that boundary;
    # fileB after it.
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.review.reviewing" that adds "fileA.ts" with:
      """
      export const A = 1
      """
    And a commit "gtd(agent): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: aaaaaaa
      <!-- base: 0000000 -->

      ## A
      - [ ] ./fileA.ts#1
      """
    And a commit "gtd(human): build.review.deciding" that adds ".gtd/REVIEW_RAW.md" with:
      """
      Feedback:
      - [ ] ./fileA.ts#1 — also add B
      """
    And I mark the current commit as "review-round-1"
    And a commit "gtd(agent): build.review.collecting" that adds ".gtd/marker.md" with:
      """
      entering re-unwind
      """
    And a commit "gtd(agent): build.health.check" that adds "fileB.ts" with:
      """
      export const B = 2
      """
    And a commit "gtd(check): build.review.reviewing" that adds ".gtd/note.md" with:
      """
      green, re-reviewing
      """
    When I run gtd next
    Then it succeeds
    # The reviewing prompt names it.reviewBase — the previous review round's
    # boundary — not fileA/fileB directly; no diff content is ever inlined.
    And stdout contains the hash of "review-round-1"

  @inmem
  Scenario: a green check run that also cleans up leftover feedback moves on to reviewing with no residue (D .gtd/FEEDBACK.md)
    Given a test project
    And the workflow
    # Blanks the queue so a green health check hands straight to the human
    # review tail — the quality lap itself is covered in its own feature.
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And a commit "gtd(agent): build.fix" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And a commit "gtd(agent): build.health.check" that adds ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality.seeding"
    And ".gtd/FEEDBACK.md" does not exist
    # Blank GTD_QUALITYREVIEWS empties the queue — seeding's own clean tree
    # hands straight on to the human review tail.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.seeding → build.review.reviewing"

  @inmem
  Scenario: repeated check failures escalate once fixing's retry cap (3) is reached, writing a fix-design document a human can edit before the next fix turn
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.health.check" that adds ".gtd/FEEDBACK.md" with:
      """
      attempt 1 failed
      """
    And a commit "gtd(check): build.fix" that adds ".gtd/fix-1.md" with:
      """
      fixed attempt 1
      """
    And a commit "gtd(agent): build.health.check" that adds ".gtd/FEEDBACK.md" with:
      """
      attempt 2 failed
      """
    And a commit "gtd(check): build.fix" that adds ".gtd/fix-2.md" with:
      """
      fixed attempt 2
      """
    And a commit "gtd(agent): build.health.check" that adds ".gtd/FEEDBACK.md" with:
      """
      attempt 3 failed
      """
    And a commit "gtd(check): build.fix" that adds ".gtd/fix-3.md" with:
      """
      fixed attempt 3
      """
    And a commit "gtd(agent): build.health.check" that adds ".gtd/marker.md" with:
      """
      entering checking a 4th time
      """
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 4 failed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.health.escalate"
    # build.health.escalate is now a round-counting `check` gate, not a human
    # rest: this is the first arrival since the last green check (0 rounds so
    # far), so its own script leaves the tree clean and the "C" row routes on
    # to build.health.describe.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.escalate → build.health.describe"
    When I run gtd next
    Then it succeeds
    And stdout contains ".gtd/FEEDBACK.md"
    And stdout contains ".gtd/PRIOR_FEEDBACK.md"
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
    # detour back through build.health.check first, unlike the old
    # human-rest escalate.
    Given a file ".gtd/marker2.md" with:
      """
      landing the escalation document as the next fix turn's instruction
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.health.stop → build.fix"
    When I run gtd next
    Then it succeeds
    # fixFeedbackPrompt names .gtd/ESCALATION.md as the primary instruction
    # whenever it is present.
    And stdout contains ".gtd/ESCALATION.md"
    Given a file "src/thing.ts" with:
      """
      export const thing = 2
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"
    # A second red run: if the retry budget were still process-pooled (the
    # OLD whole-trace rule), this would see build.fix's 3 prior visits and
    # bounce straight back to build.health.escalate. Reaching build.fix
    # instead is the proof the escalation round genuinely restored it —
    # build.health.describe (a non-source of build.fix) sat between every
    # pair of arrivals.
    Given a file ".gtd/FEEDBACK.md" with:
      """
      attempt 5 failed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.fix"

  @inmem
  Scenario: landing build.health.stop with a clean tree still hands the document to the next fix turn, and editing ESCALATION.md there does not spend a second escalation round
    Given a test project
    And the workflow
    And a commit "gtd(check): build.health.check → build.health.escalate" that adds ".gtd/marker1.md" with:
      """
      entering the first escalation round
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.escalate → build.health.describe"
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
    # Jump straight to a second arrival at escalate the same way the
    # existing two-full-rounds scenario does (an injected commit), rather
    # than re-driving the retry-cap's own 3-strikes count — that mechanism
    # is unrelated to what this scenario pins.
    Given a commit "gtd(check): build.health.check → build.health.escalate" that adds ".gtd/marker3.md" with:
      """
      entering what must be the SECOND escalation round, not the third
      """
    # If the human's edit at `stop` had counted as a round, this would see 2
    # prior rounds already and land straight at the terminal `exhausted`
    # stop. Reaching `describe` instead is the proof it didn't.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.escalate → build.health.describe"

  @inmem
  Scenario: landing build.health.stop with a genuinely clean tree still advances to build.fix — "land it untouched" as its message promises
    Given a test project
    And the workflow
    And a commit "gtd(check): build.health.check → build.health.escalate" that adds ".gtd/marker1.md" with:
      """
      entering the first escalation round
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.escalate → build.health.describe"
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
    # Round 1: the round-counting escalate gate's first arrival since the
    # last green check — 0 prior `.gtd/ESCALATION.md` rounds, so its script
    # leaves the tree clean ("C") and routes on to describe.
    And a commit "gtd(check): build.health.check → build.health.escalate" that adds ".gtd/marker1.md" with:
      """
      entering the first escalation round
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.escalate → build.health.describe"
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
    # the check and deletes `.gtd/FEEDBACK.md` (fixFeedbackPrompt's own
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
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.fix"
    And ".gtd/ESCALATION.md" contains "Round 1: the suite fails"

    # Round 2: back at the same red check, escalating again — still under 2
    # prior rounds (round 1's own add is the only one so far), so the script
    # again leaves the tree clean and routes on to describe rather than the
    # terminal stop.
    Given a commit "gtd(check): build.health.check → build.health.escalate" that adds ".gtd/marker3.md" with:
      """
      entering the second escalation round
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.escalate → build.health.describe"
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
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.fix"
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
    Given a commit "gtd(check): build.health.check → build.health.escalate" that adds ".gtd/marker5.md" with:
      """
      entering the third escalation round
      """
    Given a file ".gtd/ESCALATION.md" with:
      """
      Round 2: still the same fixture, now with a different failing assertion.

      <!-- gtd escalate 0000000 -->
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.escalate → build.health.exhausted"
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
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/thing.ts#1
      """
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
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/thing.ts#1
      """
    Given I mark the current commit as "before"
    When I run gtd next
    Then it succeeds
    And the current commit is the same as "before"
    And no ref under "refs/worktree/gtd/" was created

  @inmem
  Scenario: a sign-off lands even with a box still unticked — a tick only records that a hunk was read
    Given a test project
    And the workflow
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/a.ts#1
      - [ ] ./src/b.ts#1
      """
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
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → idle"

  @inmem
  Scenario: at await-review, gtd next surfaces the sign-off vs. feedback contract in its human-gate message
    Given a test project
    And the workflow
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/thing.ts#1
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "**Sign off** — leave no comment"
    And stdout contains "**Request changes** — leave a comment"
    And stdout contains "Deleting `.gtd/REVIEW.md` is refused."

  @inmem
  Scenario: a code edit at await-review is feedback — it routes to review-deciding (which turns it into a fix + re-review round)
    Given a test project
    And the workflow
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/thing.ts#1
      """
    Given a file "src/extra.ts" with:
      """
      export const extra = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

  @inmem
  Scenario: an ordinary sign-off commit into idle is a process boundary — a fresh process's fixing retry budget doesn't pool with a previous process's
    Given a test project
    And the workflow
    # cycle 1: already spent its whole fixing retry budget (3 entries) before
    # ending at a commit entering `idle` — the sign-off edge's own boundary
    # commit, per computeProcessRun stopping at any commit entering the
    # workflow's initial state.
    And a commit "gtd(agent): build.health.check" that adds ".gtd/FEEDBACK.md" with:
      """
      cycle 1 attempt 1 failed
      """
    And a commit "gtd(check): build.fix" that adds ".gtd/fix-1.md" with:
      """
      fixed cycle 1 attempt 1
      """
    And a commit "gtd(agent): build.health.check" that adds ".gtd/FEEDBACK.md" with:
      """
      cycle 1 attempt 2 failed
      """
    And a commit "gtd(check): build.fix" that adds ".gtd/fix-2.md" with:
      """
      fixed cycle 1 attempt 2
      """
    And a commit "gtd(agent): build.health.check" that adds ".gtd/FEEDBACK.md" with:
      """
      cycle 1 attempt 3 failed
      """
    And a commit "gtd(check): build.fix" that adds ".gtd/fix-3.md" with:
      """
      fixed cycle 1 attempt 3
      """
    And a commit "gtd(check): build.review.deciding → idle" that adds "src/cycle1.ts" with:
      """
      export const cycle1 = 1
      """
    # cycle 2 starts fresh after the sign-off boundary. If retry counts pooled
    # across it, this process's very FIRST entry into "build.fix" would
    # already see 3 prior visits and redirect straight to "escalate".
    And a commit "gtd(agent): build.health.check" that adds ".gtd/marker.md" with:
      """
      fresh process boundary — cycle 2, first pass through build.health.check
      """
    Given a file ".gtd/FEEDBACK.md" with:
      """
      cycle 2 attempt 1 failed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.fix"

  @inmem
  Scenario: each machine's own agent states compute a memory key from their owning machine-instance scope
    # Memory is COMPUTED (src/Edge.ts's memoryKeyFor) from each state's owning
    # machine-instance scope (scopes[name]) plus a commit-anchored hash — there
    # is no authored `memory:` label any more. design/architecture are sibling
    # machines with distinct scopes ("design"/"architecture"); packages.item's
    # own scope is "packages.item"; build/build.review are "build"/
    # "build.review" (humanReview nested inside buildTail) — see
    # src/workflows/unified.yaml.
    Given a test project
    And the workflow
    And a commit "gtd(check): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And stdout matches "\"memory\":\"design#[0-9a-f]{7}\""
    Given a commit "gtd(check): architecture.author" that adds ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: src/thing.ts.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"architecture.author\""
    And stdout matches "\"memory\":\"architecture#[0-9a-f]{7}\""
    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-thing.md
      """
    And a commit "gtd(human): packages.item.building" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.building\""
    And stdout matches "\"memory\":\"packages\.item#[0-9a-f]{7}\""
    Given a commit "gtd(human): build.fix" that adds ".gtd/FEEDBACK.md" with:
      """
      a failing test
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And stdout matches "\"memory\":\"build#[0-9a-f]{7}\""
    Given a commit "gtd(human): build.review.reviewing" that adds "src/thing2.ts" with:
      """
      export const thing2 = 2
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And stdout matches "\"memory\":\"build\.review#[0-9a-f]{7}\""

  @inmem
  Scenario: a custom two-level nested machine reference resolves $param bindings and qualified names across both levels
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          leaf:
            params: [onDone]
            entry: work
            states:
              work:
                actor: agent
                prompt: "do the work"
                on:
                  "* **": $onDone
          mid:
            params: [onDone]
            entry: gate
            states:
              gate:
                actor: human
                message: "approve?"
                on:
                  "* **": inner
              inner:
                machine: leaf
                with:
                  onDone: $onDone
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": nested
              nested:
                machine: mid
                with:
                  onDone: done
              done:
                actor: human
                message: "done"
      """
    And a file "NOTE.md" with:
      """
      kick off
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → nested.gate"

    # root's own idle -> nested resolved through mid's own entry (nested.gate);
    # this step resolves ONE level deeper still, through mid's "inner" reference
    # into leaf's own entry (nested.inner.work) — a two-level qualified name.
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

    # leaf's own $onDone was bound at mid's reference site to mid's OWN
    # $onDone, which was in turn bound at root's reference site to "done" — a
    # param threaded grandparent -> parent -> child resolves in the
    # grandparent's namespace, landing on the ordinary state two levels up.
    Given a file "NOTE.md" with:
      """
      done
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): nested.inner.work → done"
