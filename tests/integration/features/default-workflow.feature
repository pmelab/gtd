@inmem
Feature: The bundled default workflow — full cycle journeys

  Comprehensive coverage of `src/workflows/default.yaml` (see its own header
  comment for the state list) beyond smoke.feature's minimal hops: the full
  idle-through-done cycle including a check/fix round and the squash finale,
  the fix-retry-escalate path once `fixing`'s cap (max 3) is reached, and the
  await-review feedback loop that sends a cycle back through grilling. A
  check turn is simulated by writing `.gtd/FEEDBACK.md` directly and running
  `gtd step check` — @inmem never executes the check script itself.

  Scenario: the full cycle advances idle through done, including a check/fix round
    Given a test project
    And a file ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    Given ".gtd/TODO.md" is modified to:
      """
      Build a thing. Developed into a concrete plan with no open questions.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): grilling-answer"
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): architecting"
    Given a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan for the thing.
      """
    And the file ".gtd/TODO.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): architecting-answer"
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): decompose"
    Given a file ".gtd/01-build-thing.md" with:
      """
      Task spec: build the thing.
      """
    And the file ".gtd/ARCHITECTURE.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): building"
    Given the file ".gtd/01-build-thing.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): checking"
    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): fixing"
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): checking"
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): reviewing"
    Given a file ".gtd/REVIEW.md" with:
      """
      ## Add thing
      - [ ] src/thing.ts#1
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): await-review"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): squashing"
    Given a file ".gtd/COMMIT_MSG.md" with:
      """
      feat: build a thing

      Implements the thing end to end.
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

  Scenario: await-review feedback (anything but deleting REVIEW.md) sends the cycle back to grilling
    Given a test project
    And a commit "gtd(agent): await-review" that adds ".gtd/REVIEW.md" with:
      """
      ## Add thing
      - [ ] src/thing.ts#1
      """
    And ".gtd/REVIEW.md" is modified to:
      """
      ## Add thing
      - [ ] src/thing.ts#1

      Please also add a test for the empty-input case.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
