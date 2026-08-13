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
  the shared review + squash tail (`build.*`) are unchanged: health/fix,
  per-package spec review, the human review gate's sign-off-vs-feedback
  arbiter, and the squash finale.

  Every `check`-actor state here (`start-gate.check`, `design.gate.check`,
  `architecture.gate.check`, `packages.picking`, `packages.item.health.check`,
  `packages.item.closing`, `build.health.check`, `build.review.deciding`) is
  simulated on the `@inmem` scenarios below by writing its verdict file
  directly and running `gtd land` — `@inmem` never executes the scripts
  themselves. The one scenario that actually needs the real shell script
  (`design.gate.check`'s HEAD-stamping mechanic) is tagged `@live` and runs it
  for real via "I execute the printed check script".

  @inmem
  Scenario: an ordinary code change starts the process — triage, both gates skip when question-free, one package built/fixed/reviewed, then a review feedback round into the squash finale
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

    # start-gate.check: green baseline gate -> design.triage
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
    # straight to architecture.author with NO human stop at design.gate.answer
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.check → architecture.author"

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

    # architecture.decompose: one package file per concern, mechanically,
    # deletes ARCHITECTURE.md
    Given the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-greeting.md" with:
      """
      Package: the greeting export. Independent tasks:
      - [ ] add src/greeter.ts exporting `greet`
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): architecture.decompose → packages.picking"

    # packages.picking: takes the first (only) package file into NEXT.md
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

    # packages.item.health.check (red): a failing run -> packages.item.fix-suite
    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.health.check → packages.item.fix-suite"

    # packages.item.fix-suite: fixes it, deletes FEEDBACK.md -> health.check
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.fix-suite → packages.item.health.check"

    # packages.item.health.check (green) -> packages.item.spec.review
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.health.check → packages.item.spec.review"

    # packages.item.spec.review (issues) -> packages.item.fix-spec
    Given a file ".gtd/SPEC_FEEDBACK.md" with:
      """
      greet() should be documented with a doc comment.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.fix-spec"

    # packages.item.fix-spec: addresses it, deletes SPEC_FEEDBACK.md -> health.check
    Given the file ".gtd/SPEC_FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.fix-spec → packages.item.health.check"

    # packages.item.health.check (green) -> packages.item.spec.review again
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.health.check → packages.item.spec.review"

    # packages.item.spec.review (clean = approval) -> packages.item.closing
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.closing"

    # packages.item.closing: removes the package file and NEXT.md -> picking
    Given the file ".gtd/packages/01-greeting.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.closing → packages.picking"

    # packages.picking: the queue is now drained -> the shared review tail
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.picking → build.review.reviewing"

    # build.review.reviewing: writes REVIEW.md and hands to await-review
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add greeter.ts

      - [ ] ./src/greeter.ts#1 — new export
      """
    When I run gtd land
    Then it succeeds
    And the git ref "refs/worktree/gtd/review-head" exists
    When I run gtd status
    Then it succeeds
    And stdout contains "State: build.review.await-review"

    # await-review: a COMMENT is feedback — a note added to the line
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add greeter.ts

      - [x] ./src/greeter.ts#1 — new export — also add a doc comment
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

    # build.review.deciding: captures the raw material, removes REVIEW.md
    Given a file ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      ## Notes the human added to REVIEW.md this round

      - [x] ./src/greeter.ts#1 — new export — also add a doc comment
      """
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.collecting"

    # build.review.collecting: turns it into instructions -> build.addressing
    Given a file ".gtd/REVIEW_FEEDBACK.md" with:
      """
      1. ./src/greeter.ts#1 — add a doc comment above the new export
      """
    And the file ".gtd/REVIEW_RAW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → build.addressing"

    # build.addressing: implements it, deletes the feedback file -> health.check
    Given the file ".gtd/REVIEW_FEEDBACK.md" is deleted
    And "src/greeter.ts" is modified to:
      """
      // Greets the world.
      export const greet = () => "hi"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.addressing → build.health.check"

    # build.health.check (green) -> build.review.reviewing regenerates an
    # INCREMENTAL REVIEW.md
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: def5678
      <!-- base: def5678901234567890123456789012345678abc -->

      ## Doc comment

      - [ ] ./src/greeter.ts#1 — doc comment added
      """
    When I run gtd land
    Then it succeeds
    And the git ref "refs/worktree/gtd/review-head" exists
    When I run gtd status
    Then it succeeds
    And stdout contains "State: build.review.await-review"

    # await-review: tick every box, leave no comment -> sign-off
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: def5678
      <!-- base: def5678901234567890123456789012345678abc -->

      ## Doc comment

      - [x] ./src/greeter.ts#1 — doc comment added
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.squashing"

    # build.squashing: the agent writes the one-commit message; entering
    # `done` collapses the whole process into a single commit
    Given a file ".gtd/COMMIT_MSG.md" with:
      """
      feat: add greeting export with a doc comment

      Implements the greet export and documents it.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "feat: add greeting export with a doc comment"
    And the git status is clean
    And ".gtd/REQUIREMENTS.md" does not exist
    And ".gtd/ARCHITECTURE.md" does not exist
    And ".gtd/packages/01-greeting.md" does not exist
    And ".gtd/REVIEW.md" does not exist
    And ".gtd/COMMIT_MSG.md" does not exist
    And "src/greeter.ts" exists

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
    # tick exactly one option -> loops back to design.triage to fold it in
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
    # replace the placeholder with real text -> answered, loops to architecture.author
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
    # never fall through to architecture.author.
    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.check → design.gate.answer"

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
    # before anything could reach the squash finale.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.check → architecture.author"
    And "SCRATCH.md" does not exist
    And "src/real.ts" does not exist

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
    And stdout contains "You do NOT resume the design conversation"

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

    # packages.item.building: an earlier package's fix turn already
    # implemented the widget factory — the agent records evidence instead of
    # implementing anything
    Given a file ".gtd/SATISFIED.md" with:
      """
      - [x] add src/widget.ts — already present, see commit
        "gtd(agent): packages.picking → packages.item.building"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building → packages.item.health.check"

    # packages.item.health.check (green) -> packages.item.spec.review
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.health.check → packages.item.spec.review"

    # packages.item.spec.review (clean = approval — the reviewer's own range
    # is process-wide, so it can see the earlier package's commit that
    # satisfied this spec) -> packages.item.closing
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.closing"

    # packages.item.closing: removes the package file, NEXT.md, and the
    # satisfied evidence -> packages.picking
    Given the file ".gtd/packages/01-widget.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    And the file ".gtd/SATISFIED.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.closing → packages.picking"

    # packages.picking: the queue is now empty — a clean step closes out to
    # the shared review tail
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.picking → build.review.reviewing"

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
    And a commit "gtd(human): build.review.deciding" that adds ".gtd/REVIEW_FEEDBACK.md" with:
      """
      Feedback:
      - [ ] ./fileA.ts#1 — also add B
      """
    And I mark the current commit as "review-round-1"
    And a commit "gtd(check): build.addressing" that adds ".gtd/marker.md" with:
      """
      entering build.addressing
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
    And a commit "gtd(agent): build.addressing" that adds "src/thing.ts" with:
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
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"
    And ".gtd/FEEDBACK.md" does not exist

  @inmem
  Scenario: repeated check failures escalate once fixing's retry cap (3) is reached
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

  @inmem
  Scenario: deleting REVIEW.md at await-review is refused — sign off by ticking every box, not by deleting
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
    # stays at the gate for the reviewer to restore + tick. (What a refusal
    # does to an OPEN review window is review-window.feature's subject; no
    # step has landed at the gate here, so there is none.)
    And the commit count is unchanged

  @inmem
  Scenario: stepping at await-review with a box still unticked and no comment is refused — finish reviewing first
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
    # Tick only the first item, leave the second, add no note and no code edit.
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [x] ./src/a.ts#1
      - [ ] ./src/b.ts#1
      """
    And I record the commit count
    When I run gtd land
    Then it fails
    And stderr contains "still unticked and no comment"
    # Nothing committed — the reviewer stays at the gate.
    And the commit count is unchanged

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
    And stdout contains "**Sign off** — tick EVERY box and leave no comment"
    And stdout contains "**Request changes** — leave a comment"
    And stdout contains "no comment is refused"

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
  Scenario: an approved process's squash commit is a process boundary — a fresh process's fixing retry budget doesn't pool with a previous process's
    Given a test project
    And the workflow
    # cycle 1: already spent its whole fixing retry budget (3 entries) before
    # ending at a squash commit — a plain (non-gtd) commit subject, which is a
    # process boundary.
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
    And a commit "feat: cycle 1 complete" that adds "src/cycle1.ts" with:
      """
      export const cycle1 = 1
      """
    # cycle 2 starts fresh after the squash boundary. If retry counts pooled
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
                commit: "chore: done"
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
    # grandparent's namespace, landing on the commit state two levels up.
    Given a file "NOTE.md" with:
      """
      done
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "chore: done"
