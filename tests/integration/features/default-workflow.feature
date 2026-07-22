@inmem
Feature: The bundled default workflow — full cycle journeys

  Comprehensive coverage of `src/workflows/default.yaml` (see its own header
  comment for the state list) beyond smoke.feature's minimal hops: the full
  idle-through-approval cycle including a check/fix round, the
  fix-retry-escalate path once `fixing`'s cap (max 3) is reached, the
  await-review feedback loop that sends a cycle back through grilling, and
  the process-boundary rule that keeps a fresh cycle's retry budget from
  pooling with a previous, already-approved one. A check turn (`checking`) is
  simulated by writing its verdict file directly (`.gtd/FEEDBACK.md`) and
  running `gtd step check` — @inmem never executes the script itself.

  The cycle ends at human approval, resting back at `idle` — there is no
  squash. Every commit the cycle authored stays in history; whether/how to
  squash them is entirely up to the human (see docs/examples/advanced-workflow.md
  for a workflow that adds a squash finale back on top of this one).

  Scenario: the full cycle advances idle through an await-review approval, including a check/fix round and a feedback lap, and rests at idle with no squash
    Given a test project
    And a file ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"

    # grilling: a single agent turn develops the sketch into a plan, no Q&A loop
    Given ".gtd/TODO.md" is modified to:
      """
      Build a thing. Implementation plan: add src/thing.ts exporting `thing`.

      ## Assumptions
      - No existing thing.ts to conflict with.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): building"

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

    # checking (green): a clean step moves straight to await-review
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): await-review"

    # await-review: request changes first (anything pending is feedback, back to grilling)
    Given a file ".gtd/TODO.md" with:
      """
      Also add a doc comment to thing.ts.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"

    # second lap: grilling -> building -> checking (green) -> await-review
    Given ".gtd/TODO.md" is modified to:
      """
      Also add a doc comment to thing.ts. Plan: add a one-line comment above
      the export.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): building"
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
    And the last commit subject is "gtd(check): await-review"

    # await-review: approve with a clean tree — the cycle ends and rests at
    # idle, with NO squash: every turn commit the cycle authored stays in
    # history for the human to squash however they prefer, or not at all.
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle"
    And the git status is clean
    And ".gtd/TODO.md" does not exist
    And ".gtd/FEEDBACK.md" does not exist
    And "src/thing.ts" exists
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      gtd(human): grilling
      gtd(agent): building
      gtd(agent): checking
      gtd(check): fixing
      gtd(agent): checking
      gtd(check): await-review
      gtd(human): grilling
      gtd(agent): building
      gtd(agent): checking
      gtd(check): await-review
      gtd(human): idle
      """

  Scenario: a green check run that also cleans up leftover feedback rests at await-review with no residue (D .gtd/FEEDBACK.md)
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
    And the last commit subject is "gtd(check): await-review"
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

  Scenario: await-review feedback (anything pending) sends the cycle back to grilling
    Given a test project
    And a commit "gtd(check): await-review" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And a file ".gtd/TODO.md" with:
      """
      Please also add a test for the empty-input case.
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
    And a commit "gtd(check): await-review" that adds ".gtd/cycle1-note.md" with:
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
    And the last commit subject is "gtd(agent): building"
    Given the file ".gtd/TODO.md" is deleted
    And a file "src/thing2.ts" with:
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
