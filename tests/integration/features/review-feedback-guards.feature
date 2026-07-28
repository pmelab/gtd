@inmem
Feature: Review feedback — capture, classification, and the no-op guards

  The review feedback lap of the bundled unified workflow (see STATES.md §10).
  A human comment at `await-review` routes to `review-deciding`, which CAPTURES
  the raw material into `.gtd/REVIEW_RAW.md` (never interprets it). The new
  `feedback-collecting` agent turns that raw material into an explicit
  instruction list in `.gtd/REVIEW_FEEDBACK.md`; `feedback-building` then
  IMPLEMENTS the list and deletes it.

  Two no-op guards keep review feedback from silently evaporating (the bug this
  flow fixes — feedback captured, then deleted on the next turn without being
  addressed):

  - `feedback-collecting` declares no edge for "raw consumed, nothing written",
    so a silent no-op (delete REVIEW_RAW.md, write no instructions) matches no
    pattern and is REFUSED by the pure engine.
  - `feedback-building` declares `requireProgress: true`, so the edge gate
    (`enforceFeedbackProgressGate`) REFUSES a turn whose only change is deleting
    the instructions file — unless it held a `NOTHING ACTIONABLE` sentinel.

  Each check-actor turn (`review-deciding`) is simulated by writing its verdict
  files and running `gtd step check`; @inmem never executes the scripts.

  Background:
    Given a test project
    And the workflow
    And a commit "gtd(agent): building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(check): await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1 — new add function
      """

  Scenario: a note flows through capture and classification into a build
    # await-review: the human leaves a note (a change beyond a tick) → feedback
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1 — new add function — rename `add` to `sum`
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): await-review → review-deciding"

    # review-deciding: CAPTURES raw material into REVIEW_RAW.md, removes REVIEW.md
    Given a file ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      ## Notes the human added to REVIEW.md this round

      - [x] ./src/calc.ts#1 — new add function — rename `add` to `sum`
      """
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): review-deciding → feedback-collecting"

    # feedback-collecting: raw material → instruction list, deletes the raw file
    Given a file ".gtd/REVIEW_FEEDBACK.md" with:
      """
      1. ./src/calc.ts#1 — rename the exported `add` to `sum`
      """
    And the file ".gtd/REVIEW_RAW.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): feedback-collecting → feedback-building"

    # feedback-building: implements the instruction and deletes the file
    Given "src/calc.ts" is modified to:
      """
      export const sum = (a: number, b: number) => a + b
      """
    And the file ".gtd/REVIEW_FEEDBACK.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): feedback-building → checking"

  Scenario: feedback-building refuses a work-free turn that just deletes the instructions
    Given an empty commit "gtd(human): await-review → review-deciding"
    And a commit "gtd(agent): feedback-collecting → feedback-building" that adds ".gtd/REVIEW_FEEDBACK.md" with:
      """
      1. ./src/calc.ts#1 — rename the exported `add` to `sum`
      """
    # The BUG behaviour: delete the instructions without doing the work
    Given the file ".gtd/REVIEW_FEEDBACK.md" is deleted
    When I run gtd step agent
    Then it fails
    And stderr contains "without addressing its instructions"

  Scenario: feedback-building allows deleting a NOTHING ACTIONABLE sentinel with no code change
    Given an empty commit "gtd(human): await-review → review-deciding"
    And a commit "gtd(agent): feedback-collecting → feedback-building" that adds ".gtd/REVIEW_FEEDBACK.md" with:
      """
      NOTHING ACTIONABLE — the human left only an approving remark.
      """
    # A non-actionable round makes no code change; deleting the sentinel is fine
    Given the file ".gtd/REVIEW_FEEDBACK.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): feedback-building → checking"

  Scenario: feedback-collecting refuses a silent no-op — raw consumed, nothing written
    Given a commit "gtd(check): review-deciding → feedback-collecting" that adds ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      ## Notes the human added to REVIEW.md this round

      - [x] ./src/calc.ts#1 — rename `add` to `sum`
      """
    # Silent no-op: consume the raw file, produce no instruction list
    Given the file ".gtd/REVIEW_RAW.md" is deleted
    When I run gtd step agent
    Then it fails
    And stderr contains "no declared pattern matches"
