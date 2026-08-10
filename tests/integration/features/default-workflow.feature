@inmem
Feature: The bundled unified workflow — simple-flow full-process journeys

  Comprehensive coverage of the SIMPLE entry of `src/workflows/unified.yaml`
  (started by creating `.gtd/TODO.md`) through the SHARED tail: the
  planning/await-plan iteration loop, a check/fix round, the fix-retry-escalate
  path once `fixing`'s cap (max 3) is reached, the human review gate and its
  `build.review.deciding` arbiter (a COMMENT — a note or a code edit — is feedback; an
  all-ticked no-comment step is sign-off), the sign-off gate's refusals (an
  unfinished review, a deleted REVIEW.md), and the SQUASH finale (`build.squashing` →
  `done`) that every entry point shares — the only path to which is full
  sign-off.

  The simple flow's `.gtd/TODO.md` is a free-form plan the human iterates on by
  editing it — no `qa` mode, no open-questions Q&A (that lives in the ADVANCED
  flow). REVIEW.md checkboxes aren't validated by an in-machine state either —
  the producing agent self-validates via `gtd validate` (covered in
  validate.feature), so `plan.planning` hands straight to `plan.await-plan` and
  `build.review.reviewing` straight to `build.review.await-review`. The remaining `check`-actor states
  here (`build.health.check`, `build.review.deciding`) are simulated by writing their verdict
  files directly and running `gtd step check` — @inmem never executes the
  scripts themselves.

  Scenario: the full simple process — plan, build, check/fix, review with a feedback lap, then full sign-off into the squash finale
    Given a test project
    And the workflow
    And a file ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → plan-gate.check"

    # plan-gate.check: green baseline gate — a clean tree (tests pass) -> plan.planning
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): plan-gate.check → plan.planning"

    # plan.planning: develops the sketch into a concrete plan and hands to plan.await-plan
    Given ".gtd/TODO.md" is modified to:
      """
      Build a thing. Implementation plan: add src/thing.ts exporting `thing`,
      named export only.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): plan.planning → plan.await-plan"

    # await-plan: accept the plan as-is with a clean step -> build.building
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): plan.await-plan → build.building"

    # build.building: implements the plan directly, deletes TODO.md when done
    Given the file ".gtd/TODO.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): build.building → build.health.check"

    # build.health.check (red): a failing run leaves FEEDBACK.md, sends the process to build.fix
    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.fix"

    # build.fix: addresses the feedback, deletes it, steps back to build.health.check
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"

    # build.health.check (green): a clean step moves on to build.review.reviewing
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"

    # reviewing: writes REVIEW.md and hands straight to await-review
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1 — new export
      """
    When I run gtd step agent
    Then it succeeds
    # await-review declares `reviewWindow: true` — resolve the true rest via
    # `gtd status` rather than raw HEAD.
    And the git ref "refs/worktree/gtd/review-head" exists
    When I run gtd status
    Then it succeeds
    And stdout contains "State: build.review.await-review"

    # await-review: a COMMENT is feedback — here a note added to the line (the
    # box may be ticked or not; the note is the signal). Every human step routes
    # to the decider.
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [x] ./src/thing.ts#1 — new export — also add a doc comment
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

    # build.review.deciding: the note is a change to REVIEW.md beyond a tick, so it
    # CAPTURES the raw material into REVIEW_RAW.md and removes REVIEW.md — the
    # A/M REVIEW_RAW.md row is declared before the D REVIEW.md row so a feedback
    # round wins
    Given a file ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      ## Notes the human added to REVIEW.md this round

      - [x] ./src/thing.ts#1 — new export — also add a doc comment
      """
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.collecting"

    # build.review.collecting: turns the raw material into an instruction list in
    # REVIEW_FEEDBACK.md and deletes REVIEW_RAW.md, stepping to build.addressing
    Given a file ".gtd/REVIEW_FEEDBACK.md" with:
      """
      1. ./src/thing.ts#1 — add a doc comment above the new export
      """
    And the file ".gtd/REVIEW_RAW.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → build.addressing"

    # build.addressing: implements the requested change directly (no Q&A),
    # deletes the feedback file, steps to build.health.check
    Given the file ".gtd/REVIEW_FEEDBACK.md" is deleted
    And "src/thing.ts" is modified to:
      """
      // The thing.
      export const thing = 1
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): build.addressing → build.health.check"

    # build.health.check (green) -> build.review.reviewing regenerates an incremental REVIEW.md
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: def5678
      <!-- base: def5678901234567890123456789012345678abc -->

      ## Doc comment

      - [ ] ./src/thing.ts#1 — doc comment added
      """
    When I run gtd step agent
    Then it succeeds
    And the git ref "refs/worktree/gtd/review-head" exists
    When I run gtd status
    Then it succeeds
    And stdout contains "State: build.review.await-review"

    # await-review: tick every box and leave no comment — the decider sees no
    # note and no code edit, removes REVIEW.md, routing to the squash finale
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: def5678
      <!-- base: def5678901234567890123456789012345678abc -->

      ## Doc comment

      - [x] ./src/thing.ts#1 — doc comment added
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.squashing"

    # build.squashing: the agent writes the one-commit message; entering `done`
    # collapses the whole process into a single commit and leaves .gtd empty
    Given a file ".gtd/COMMIT_MSG.md" with:
      """
      feat: add thing with a doc comment

      Implements the thing export and documents it.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "feat: add thing with a doc comment"
    And the git status is clean
    And ".gtd/TODO.md" does not exist
    And ".gtd/REVIEW.md" does not exist
    And ".gtd/COMMIT_MSG.md" does not exist
    And "src/thing.ts" exists

  Scenario: a feedback round's reviewing base is anchored at the last review round (incremental it.reviewBase)
    # reviewBase: true on build.review.deciding anchors it.reviewBase: a re-review's
    # range starts only from the previous review round's boundary, not the
    # whole process. fileA landed before that boundary; fileB after it.
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

  Scenario: a green check run that also cleans up leftover feedback moves on to reviewing with no residue (D .gtd/FEEDBACK.md)
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.building" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And a commit "gtd(agent): build.health.check" that adds ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"
    And ".gtd/FEEDBACK.md" does not exist

  Scenario: a green check run mechanically sweeps a leaked TODO.md and still moves on to reviewing (sole D .gtd/TODO.md)
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.building" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And a commit "gtd(agent): build.health.check" that adds ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    Given the file ".gtd/TODO.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"
    And ".gtd/TODO.md" does not exist

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
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.health.escalate"

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
    When I run gtd step human
    Then it fails
    And stderr contains "was deleted"
    # Nothing committed, and a refusal emits no script at all — the process
    # stays at the gate for the reviewer to restore + tick. (What a refusal
    # does to an OPEN review window is review-window.feature's subject; no
    # step has landed at the gate here, so there is none.)
    And the commit count is unchanged

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
    When I run gtd step human
    Then it fails
    And stderr contains "still unticked and no comment"
    # Nothing committed — the reviewer stays at the gate.
    And the commit count is unchanged

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
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

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
    # across it, this process's very FIRST entry into "fixing" would already see 3
    # prior visits and redirect straight to "escalate".
    And a file ".gtd/TODO.md" with:
      """
      Build a second thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → plan-gate.check"
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): plan-gate.check → plan.planning"
    Given ".gtd/TODO.md" is modified to:
      """
      Build a second thing. Plan: add src/thing2.ts exporting `thing2`.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): plan.planning → plan.await-plan"
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): plan.await-plan → build.building"
    Given a file "src/thing2.ts" with:
      """
      export const thing2 = 1
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): build.building → build.health.check"
    Given a file ".gtd/FEEDBACK.md" with:
      """
      cycle 2 attempt 1 failed
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.fix"

  Scenario: the simple flow's agent states each compute a memory key from their own machine-instance scope
    # Memory is COMPUTED (src/Edge.ts's memoryKeyFor) from each state's owning
    # machine-instance scope (scopes[name]) plus a commit-anchored hash — there
    # is no authored `memory:` label any more. Every simple-flow agent state
    # lives inside a named machine instance, so its scope is that instance's
    # qualified name: `plan.planning` -> "plan" (planLoop), `build.building`
    # and `build.fix` -> "build" (simpleBuild), `build.review.reviewing` ->
    # "build.review" (humanReview, nested inside simpleBuild) — see
    # src/workflows/unified.yaml.
    Given a test project
    And the workflow
    And a commit "gtd(human): plan.planning" that adds ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"plan.planning\""
    And stdout matches "\"memory\":\"plan#[0-9a-f]{7}\""
    Given a commit "gtd(human): build.building" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.building\""
    And stdout matches "\"memory\":\"build#[0-9a-f]{7}\""
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
