@inmem
Feature: The bundled default workflow — full cycle journeys

  Comprehensive coverage of `src/workflows/default.yaml` (see its own header
  comment for the state list) beyond smoke.feature's minimal hops: the two
  steering-file validation loops (TODO.md open questions, REVIEW.md
  checkboxes — see docs/design/steering-file-loops.md), a check/fix round,
  the fix-retry-escalate path once `fixing`'s cap (max 3) is reached, both
  review outcomes (tick-all approve and partial-tick feedback), the
  delete-shortcut approve, and the process-boundary rule that keeps a fresh
  cycle's retry budget from pooling with a previous, already-approved one.
  Both `check`-actor validators (`todo-validating`/`review-validating`/
  `review-deciding`) are simulated by writing their verdict files directly
  (`.gtd/FORMAT.md`, `.gtd/REVIEW.md`, `.gtd/TODO.md`) and running
  `gtd step check` — @inmem never executes the scripts themselves.

  The cycle ends at human approval, resting back at `idle` — there is no
  squash. Every commit the cycle authored stays in history; whether/how to
  squash them is entirely up to the human (see docs/examples/advanced-workflow.md
  for a workflow that adds a squash finale back on top of this one).

  Scenario: the full cycle advances idle through an await-review approval, including a malformed-TODO lap, a check/fix round, a malformed-REVIEW lap, and a partial-tick feedback lap, and rests at idle with no squash
    Given a test project
    And a file ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"

    # grilling: develops the sketch into a plan, but leaves an open question
    # without a "Suggested default:"/"Answer:" line — a malformed draft
    Given ".gtd/TODO.md" is modified to:
      """
      Build a thing. Implementation plan: add src/thing.ts exporting `thing`.

      ## Open Questions

      ### Should thing export a default too?

      Not sure yet.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): todo-validating"

    # todo-validating (malformed): simulate the validator finding that draft's error
    Given a file ".gtd/FORMAT.md" with:
      """
      .gtd/TODO.md:5: open question "Should thing export a default too?" is missing a "Suggested default: ..." or "Answer: ..." line
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): grilling"

    # grilling: fixes the finding
    Given the file ".gtd/FORMAT.md" is deleted
    And ".gtd/TODO.md" is modified to:
      """
      Build a thing. Implementation plan: add src/thing.ts exporting `thing`.

      ## Open Questions

      ### Should thing export a default too?

      Suggested default: no, named export only.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): todo-validating"

    # todo-validating (valid, nothing to clean up): a clean step moves to grilling-answer
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): grilling-answer"

    # grilling-answer: accept the suggested default with a clean step
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): building"

    # building: implements the plan directly, deletes TODO.md when done
    Given the file ".gtd/TODO.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): checking"

    # checking (red): a failing run leaves FEEDBACK.md, sends the cycle to fixing
    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): fixing"

    # fixing: addresses the feedback, deletes it, steps back to checking
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): checking"

    # checking (green): a clean step moves on to reviewing
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): reviewing"

    # reviewing: writes REVIEW.md, but without the required header line —
    # a malformed draft
    Given a file ".gtd/REVIEW.md" with:
      """
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1 — new export
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): review-validating"

    # review-validating (malformed): simulate the validator finding that draft's error
    Given a file ".gtd/FORMAT.md" with:
      """
      .gtd/REVIEW.md:1: missing or malformed "# Review: <hash>" header as first line
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): reviewing"

    # reviewing: fixes the finding
    Given the file ".gtd/FORMAT.md" is deleted
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1 — new export
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): review-validating"

    # review-validating (valid, nothing to clean up): a clean step moves to await-review
    When I run gtd step check
    Then it succeeds
    # await-review declares `reviewWindow: true` (STATES.md §11): landing here
    # opens the review checkout window, rewinding raw HEAD to the review base.
    # `gtd status` closes the window before reading, so it still resolves the
    # true rest — the window then re-arms on its way out.
    And the git ref "refs/gtd/review-head" exists
    When I run gtd status
    Then it succeeds
    And stdout contains "State: await-review"

    # await-review: partial-tick feedback — the reviewer adds a note without
    # ticking the box, routing to the decider (not the catch-all)
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1 — new export — also add a doc comment
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): review-deciding"

    # review-deciding: extracts the unticked pointer into a fresh TODO.md,
    # removes REVIEW.md — the decider always sees both changes, and the
    # A/M TODO.md row is declared first so feedback wins
    Given a file ".gtd/TODO.md" with:
      """
      Feedback from review — address these before continuing:

      - [ ] ./src/thing.ts#1 — new export — also add a doc comment
      """
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): grilling"

    # second lap: grilling -> todo-validating -> grilling-answer -> building
    # -> checking (green) -> reviewing -> review-validating -> await-review
    Given ".gtd/TODO.md" is modified to:
      """
      Add a doc comment to thing.ts. Plan: add a one-line comment above the
      export.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): todo-validating"
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): grilling-answer"
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): building"
    Given the file ".gtd/TODO.md" is deleted
    And a file "src/thing.ts" with:
      """
      // The thing.
      export const thing = 1
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): checking"
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): reviewing"
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: def5678
      <!-- base: def5678901234567890123456789012345678abc -->

      ## Doc comment

      - [ ] ./src/thing.ts#1 — doc comment added
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): review-validating"
    When I run gtd step check
    Then it succeeds
    # await-review opens the review checkout window (see above) — resolve the
    # true rest via `gtd status` rather than raw HEAD.
    And the git ref "refs/gtd/review-head" exists
    When I run gtd status
    Then it succeeds
    And stdout contains "State: await-review"

    # await-review: tick every box — the decider sees no unticked pointer
    # left and approves, removing REVIEW.md and resting the cycle at idle
    # with NO squash: every turn commit the cycle authored stays in history.
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: def5678
      <!-- base: def5678901234567890123456789012345678abc -->

      ## Doc comment

      - [x] ./src/thing.ts#1 — doc comment added
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): review-deciding"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): idle"
    And the git status is clean
    And ".gtd/TODO.md" does not exist
    And ".gtd/FEEDBACK.md" does not exist
    And ".gtd/FORMAT.md" does not exist
    And ".gtd/REVIEW.md" does not exist
    And "src/thing.ts" exists

  Scenario: a green check run that also cleans up leftover feedback moves on to reviewing with no residue (D .gtd/FEEDBACK.md)
    Given a test project
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
    And the last commit subject is "gtd(check): reviewing"
    And ".gtd/FEEDBACK.md" does not exist

  Scenario: repeated check failures escalate once fixing's retry cap (3) is reached
    Given a test project
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
    And the last commit subject is "gtd(check): escalate"

  Scenario: a malformed TODO.md draft bounces back to grilling and a valid one that had a stale FORMAT.md to clean up proceeds to grilling-answer
    Given a test project
    And a commit "gtd(agent): todo-validating" that adds ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    And a file ".gtd/FORMAT.md" with:
      """
      .gtd/TODO.md:1: open question "X" is missing a "Suggested default: ..." or "Answer: ..." line
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): grilling"
    Given a commit "gtd(agent): todo-validating" that adds "src/note.md" with:
      """
      the draft is fixed, FORMAT.md still lingers from the last round
      """
    Given the file ".gtd/FORMAT.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): grilling-answer"

  Scenario: a malformed REVIEW.md draft bounces back to reviewing and a valid one that had a stale FORMAT.md to clean up proceeds to await-review
    Given a test project
    And a commit "gtd(agent): review-validating" that adds ".gtd/REVIEW.md" with:
      """
      Nothing to review.
      """
    And a file ".gtd/FORMAT.md" with:
      """
      .gtd/REVIEW.md:1: missing or malformed "# Review: <hash>" header as first line
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): reviewing"
    Given a commit "gtd(agent): review-validating" that adds "src/note2.md" with:
      """
      the draft is fixed, FORMAT.md still lingers from the last round
      """
    Given the file ".gtd/FORMAT.md" is deleted
    When I run gtd step check
    Then it succeeds
    # await-review opens the review checkout window (reviewWindow: true) — assert
    # the resolved state via `gtd status`, which closes the window before reading.
    And the git ref "refs/gtd/review-head" exists
    When I run gtd status
    Then it succeeds
    And stdout contains "State: await-review"

  Scenario: deleting REVIEW.md outright at await-review is the power-user approve shortcut, bypassing review-deciding
    Given a test project
    And a commit "gtd(check): await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/thing.ts#1
      """
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle"
    And ".gtd/REVIEW.md" does not exist

  Scenario: at await-review, gtd next surfaces which change routes where — the human gate's route list, rendered from its `on` edge descriptions
    Given a test project
    And a commit "gtd(check): await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [ ] ./src/thing.ts#1
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "What each change does next (then run `gtd step human`):"
    And stdout contains "- Delete `.gtd/REVIEW.md` outright to approve the whole cycle"
    And stdout contains "- Change only code, leaving `.gtd/REVIEW.md` untouched"

  Scenario: a code-only edit at await-review (REVIEW.md untouched) is feedback straight to grilling
    Given a test project
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
    And the last commit subject is "gtd(human): grilling"

  Scenario: an approved cycle's idle-entering commit is a process boundary — a fresh cycle's fixing retry budget doesn't pool with a previous cycle's
    Given a test project
    # cycle 1: already spent its whole fixing retry budget (3 entries) before
    # ending at an approved, idle-resting boundary.
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
    And a commit "gtd(agent): checking" that adds "src/cycle1.ts" with:
      """
      export const cycle1 = 1
      """
    And a commit "gtd(check): reviewing" that adds ".gtd/cycle1-note.md" with:
      """
      cycle 1 reviewed clean
      """
    And a commit "gtd(human): idle" that adds ".gtd/cycle1-done.md" with:
      """
      cycle 1 approved — resting at idle
      """
    # cycle 2 starts fresh from idle. If retry counts pooled across the idle
    # boundary above, this cycle's very FIRST entry into "fixing" would
    # already see 3 prior visits and redirect straight to "escalate".
    And a file ".gtd/TODO.md" with:
      """
      Build a second thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    Given ".gtd/TODO.md" is modified to:
      """
      Build a second thing. Plan: add src/thing2.ts exporting `thing2`.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): todo-validating"
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): grilling-answer"
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): building"
    Given a file "src/thing2.ts" with:
      """
      export const thing2 = 1
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): checking"
    Given a file ".gtd/FEEDBACK.md" with:
      """
      cycle 2 attempt 1 failed
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): fixing"
