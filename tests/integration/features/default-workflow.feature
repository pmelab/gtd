@inmem
Feature: The bundled default workflow — full cycle journeys

  Comprehensive coverage of `src/workflows/default.yaml` (see its own header
  comment for the state list) beyond smoke.feature's minimal hops: the full
  idle-through-done cycle including a check/fix round, the fix-retry-escalate
  path once `fixing`'s cap (max 3) is reached, and the await-review feedback
  loop that sends a cycle back through grilling. A check turn (`checking`) is
  simulated by writing its verdict file directly (`.gtd/FEEDBACK.md`) and
  running `gtd step check` — @inmem never executes the script itself.

  Scenario: the full cycle advances idle through done, including a check/fix round and an await-review feedback lap
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

    # await-review: approve with a clean tree
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): squashing"

    # squashing: the agent authors the commit message, entering it squashes the cycle
    Given a file ".gtd/COMMIT_MSG.md" with:
      """
      feat: build a thing

      Implements the thing end to end, including a review-feedback round.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "feat: build a thing"
    And "src/thing.ts" exists
    And ".gtd/COMMIT_MSG.md" does not exist
    And the git status is clean

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
