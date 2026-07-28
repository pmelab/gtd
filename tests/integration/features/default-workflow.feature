@inmem
Feature: The bundled unified workflow — simple-flow full-cycle journeys

  Comprehensive coverage of the SIMPLE entry of `src/workflows/unified.yaml`
  (started by creating `.gtd/TODO.md`) through the SHARED tail: the
  grilling/answer planning loop, a check/fix round, the fix-retry-escalate path
  once `fixing`'s cap (max 3) is reached, the human review gate and its
  `review-deciding` arbiter (a COMMENT — a note or a code edit — is feedback; an
  all-ticked no-comment step is sign-off), the sign-off gate's refusals (an
  unfinished review, a deleted REVIEW.md), and the SQUASH finale (`squashing` →
  `done`) that every entry point shares — the only path to which is full
  sign-off.

  Steering-file formats (TODO.md open questions, REVIEW.md checkboxes) are not
  validated by an in-machine state — the producing agent self-validates via
  `gtd validate` (covered in validate.feature), so `grilling` hands straight to
  `grilling-answer` and `reviewing` straight to `await-review`. The remaining
  `check`-actor states here (`checking`, `review-deciding`) are simulated by
  writing their verdict files directly and running `gtd step check` — @inmem
  never executes the scripts themselves.

  Scenario: the full simple cycle — plan, build, check/fix, review with a feedback lap, then full sign-off into the squash finale
    Given a test project
    And the workflow
    And a file ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → grilling"

    # grilling: develops the sketch into a plan and hands to grilling-answer
    Given ".gtd/TODO.md" is modified to:
      """
      Build a thing. Implementation plan: add src/thing.ts exporting `thing`.

      ## Open Questions

      ### Should thing export a default too?

      No, named export only.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): grilling → grilling-answer"

    # grilling-answer: accept the suggested answer with a clean step -> building
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling-answer → building"

    # building: implements the plan directly, deletes TODO.md when done
    Given the file ".gtd/TODO.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): building → checking"

    # checking (red): a failing run leaves FEEDBACK.md, sends the cycle to fixing
    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): checking → fixing"

    # fixing: addresses the feedback, deletes it, steps back to checking
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): fixing → checking"

    # checking (green): a clean step moves on to reviewing
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): checking → reviewing"

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
    And the git ref "refs/gtd/review-head" exists
    When I run gtd status
    Then it succeeds
    And stdout contains "State: await-review"

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
    And the last commit subject is "gtd(human): await-review → review-deciding"

    # review-deciding: the note is a change to REVIEW.md beyond a tick, so it
    # writes REVIEW_FEEDBACK.md and removes REVIEW.md — the A/M REVIEW_FEEDBACK.md
    # row is declared before the D REVIEW.md row so a feedback round wins
    Given a file ".gtd/REVIEW_FEEDBACK.md" with:
      """
      Review feedback to address, then delete this file.

      ## Notes left in the review (ticked items are approved — act on the notes)

      - [x] ./src/thing.ts#1 — new export — also add a doc comment
      """
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): review-deciding → feedback-building"

    # feedback-building: implements the requested change directly (no Q&A),
    # deletes the feedback file, steps to checking
    Given the file ".gtd/REVIEW_FEEDBACK.md" is deleted
    And "src/thing.ts" is modified to:
      """
      // The thing.
      export const thing = 1
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): feedback-building → checking"

    # checking (green) -> reviewing regenerates an incremental REVIEW.md
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): checking → reviewing"
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: def5678
      <!-- base: def5678901234567890123456789012345678abc -->

      ## Doc comment

      - [ ] ./src/thing.ts#1 — doc comment added
      """
    When I run gtd step agent
    Then it succeeds
    And the git ref "refs/gtd/review-head" exists
    When I run gtd status
    Then it succeeds
    And stdout contains "State: await-review"

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
    And the last commit subject is "gtd(human): await-review → review-deciding"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): review-deciding → squashing"

    # squashing: the agent writes the one-commit message; entering `done`
    # collapses the whole cycle into a single commit and leaves .gtd empty
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

  Scenario: a feedback round's reviewing covers only the changes since the last review (incremental it.reviewDiff)
    # reviewBase: true on review-deciding anchors it.reviewDiff: a re-review sees
    # only what changed AFTER the previous review round, not the whole cycle.
    # fileA landed before the review-deciding boundary; fileB after it.
    Given a test project
    And the workflow
    And a commit "gtd(agent): reviewing" that adds "fileA.ts" with:
      """
      export const A = 1
      """
    And a commit "gtd(agent): await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: aaaaaaa
      <!-- base: 0000000 -->

      ## A
      - [ ] ./fileA.ts#1
      """
    And a commit "gtd(human): review-deciding" that adds ".gtd/REVIEW_FEEDBACK.md" with:
      """
      Feedback:
      - [ ] ./fileA.ts#1 — also add B
      """
    And a commit "gtd(check): feedback-building" that adds ".gtd/marker.md" with:
      """
      entering feedback-building
      """
    And a commit "gtd(agent): checking" that adds "fileB.ts" with:
      """
      export const B = 2
      """
    And a commit "gtd(check): reviewing" that adds ".gtd/note.md" with:
      """
      green, re-reviewing
      """
    When I run gtd next
    Then it succeeds
    # The reviewing prompt inlines it.reviewDiff — the post-feedback change
    # (fileB) but NOT the already-reviewed fileA from before the review-deciding
    # boundary.
    And stdout contains "fileB.ts"
    And stdout does not contain "fileA.ts"

  Scenario: a green check run that also cleans up leftover feedback moves on to reviewing with no residue (D .gtd/FEEDBACK.md)
    Given a test project
    And the workflow
    And a commit "gtd(agent): building" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And a commit "gtd(agent): checking" that adds ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): checking → reviewing"
    And ".gtd/FEEDBACK.md" does not exist

  Scenario: repeated check failures escalate once fixing's retry cap (3) is reached
    Given a test project
    And the workflow
    And a commit "gtd(agent): checking" that adds ".gtd/FEEDBACK.md" with:
      """
      attempt 1 failed
      """
    And a commit "gtd(check): fixing" that adds ".gtd/fix-1.md" with:
      """
      fixed attempt 1
      """
    And a commit "gtd(agent): checking" that adds ".gtd/FEEDBACK.md" with:
      """
      attempt 2 failed
      """
    And a commit "gtd(check): fixing" that adds ".gtd/fix-2.md" with:
      """
      fixed attempt 2
      """
    And a commit "gtd(agent): checking" that adds ".gtd/FEEDBACK.md" with:
      """
      attempt 3 failed
      """
    And a commit "gtd(check): fixing" that adds ".gtd/fix-3.md" with:
      """
      fixed attempt 3
      """
    And a commit "gtd(agent): checking" that adds ".gtd/marker.md" with:
      """
      entering checking a 4th time
      """
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 4 failed
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): checking → escalate"

  Scenario: deleting REVIEW.md at await-review is refused — sign off by ticking every box, not by deleting
    Given a test project
    And the workflow
    And a commit "gtd(check): await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/thing.ts#1
      """
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd step human
    Then it fails
    And stderr contains "was deleted"
    # Nothing committed — the refusal re-arms the review window, so the cycle
    # stays at the gate for the reviewer to restore + tick.
    And the git ref "refs/gtd/review-head" exists

  Scenario: stepping at await-review with a box still unticked and no comment is refused — finish reviewing first
    Given a test project
    And the workflow
    And a commit "gtd(check): await-review" that adds ".gtd/REVIEW.md" with:
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
    When I run gtd step human
    Then it fails
    And stderr contains "still unticked and no comment"
    # Nothing committed — the window re-arms, keeping the reviewer at the gate.
    And the git ref "refs/gtd/review-head" exists

  Scenario: at await-review, gtd next surfaces the sign-off vs. feedback contract in its human-gate message
    Given a test project
    And the workflow
    And a commit "gtd(check): await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/thing.ts#1
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Tick EVERY box and leave no comment"
    And stdout contains "Leave a comment to request changes"
    And stdout contains "no comment is refused"

  Scenario: a code edit at await-review is feedback — it routes to review-deciding (which turns it into a fix + re-review round)
    Given a test project
    And the workflow
    And a commit "gtd(check): await-review" that adds ".gtd/REVIEW.md" with:
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
    And the last commit subject is "gtd(human): await-review → review-deciding"

  Scenario: an approved cycle's squash commit is a process boundary — a fresh cycle's fixing retry budget doesn't pool with a previous cycle's
    Given a test project
    And the workflow
    # cycle 1: already spent its whole fixing retry budget (3 entries) before
    # ending at a squash commit — a plain (non-gtd) commit subject, which is a
    # process boundary.
    And a commit "gtd(agent): checking" that adds ".gtd/FEEDBACK.md" with:
      """
      cycle 1 attempt 1 failed
      """
    And a commit "gtd(check): fixing" that adds ".gtd/fix-1.md" with:
      """
      fixed cycle 1 attempt 1
      """
    And a commit "gtd(agent): checking" that adds ".gtd/FEEDBACK.md" with:
      """
      cycle 1 attempt 2 failed
      """
    And a commit "gtd(check): fixing" that adds ".gtd/fix-2.md" with:
      """
      fixed cycle 1 attempt 2
      """
    And a commit "gtd(agent): checking" that adds ".gtd/FEEDBACK.md" with:
      """
      cycle 1 attempt 3 failed
      """
    And a commit "gtd(check): fixing" that adds ".gtd/fix-3.md" with:
      """
      fixed cycle 1 attempt 3
      """
    And a commit "feat: cycle 1 complete" that adds "src/cycle1.ts" with:
      """
      export const cycle1 = 1
      """
    # cycle 2 starts fresh after the squash boundary. If retry counts pooled
    # across it, this cycle's very FIRST entry into "fixing" would already see 3
    # prior visits and redirect straight to "escalate".
    And a file ".gtd/TODO.md" with:
      """
      Build a second thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → grilling"
    Given ".gtd/TODO.md" is modified to:
      """
      Build a second thing. Plan: add src/thing2.ts exporting `thing2`.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): grilling → grilling-answer"
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling-answer → building"
    Given a file "src/thing2.ts" with:
      """
      export const thing2 = 1
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): building → checking"
    Given a file ".gtd/FEEDBACK.md" with:
      """
      cycle 2 attempt 1 failed
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): checking → fixing"

  Scenario: the simple flow's agent states emit their memory scope labels
    # The scope labels let a memory-aware driver retain memory within a loop
    # (same label across laps) and clear it at a phase boundary (a
    # differently-labelled state). grilling=plan, building=build, fixing=fix,
    # reviewing=review — see src/workflows/unified.yaml.
    Given a test project
    And the workflow
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"grilling\""
    And stdout contains "\"memory\":\"plan\""
    Given a commit "gtd(human): building" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"building\""
    And stdout contains "\"memory\":\"build\""
    Given a commit "gtd(human): fixing" that adds ".gtd/FEEDBACK.md" with:
      """
      a failing test
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"fixing\""
    And stdout contains "\"memory\":\"fix\""
    Given a commit "gtd(human): reviewing" that adds "src/thing2.ts" with:
      """
      export const thing2 = 2
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"reviewing\""
    And stdout contains "\"memory\":\"review\""
