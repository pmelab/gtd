@inmem
Feature: Review feedback — capture, classification, and the no-op guards

  The review feedback lap of the bundled unified workflow (see STATES.md §10).
  A human comment at `await-review` routes to `build.review.deciding`, which CAPTURES
  the raw material into `.gtd/REVIEW_RAW.md` (never interprets it). The new
  `build.review.collecting` agent turns that raw material into an explicit
  instruction list in `.gtd/REVIEW_FEEDBACK.md`; `build.addressing` then
  IMPLEMENTS the list and deletes it.

  Two no-op guards keep review feedback from silently evaporating (the bug this
  flow fixes — feedback captured, then deleted on the next turn without being
  addressed):

  - `build.review.collecting` declares no edge for "raw consumed, nothing written",
    so a silent no-op (delete REVIEW_RAW.md, write no instructions) matches no
    pattern and is REFUSED by the pure engine.
  - `build.addressing` declares `requireProgress: true`, so the
    feedback-progress guard (`src/StepGuards.ts`) REFUSES a turn whose only
    change is deleting the instructions file — unless it held a
    `NOTHING ACTIONABLE` sentinel.

  Each check-actor turn (`build.review.deciding`) is simulated by writing its verdict
  files and running `gtd land`; @inmem never executes the scripts.

  Background:
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1 — new add function
      """

  Scenario: a note-like unchecked line outside a file pointer no longer blocks sign-off
    # The committed REVIEW.md already carries a non-`./`-prefixed "- [ ]" note,
    # untouched by the human's edit below. Only the real file pointer is
    # ticked, with no other comment — this used to be refused (the old raw
    # regex counted the note's box too); now `untickedFiles` counts only
    # recognized `./`-prefixed hunk pointers inside `##` chunks, so it signs
    # off cleanly.
    Given a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      Follow-up ideas, not part of this review:
      - [ ] consider renaming the module later

      - [ ] ./src/calc.ts#1 — new add function
      """
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      Follow-up ideas, not part of this review:
      - [ ] consider renaming the module later

      - [x] ./src/calc.ts#1 — new add function
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

  Scenario: a note flows through capture and classification into a build
    # await-review: the human leaves a note (a change beyond a tick) → feedback
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1 — new add function — rename `add` to `sum`
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

    # build.review.deciding: CAPTURES raw material into REVIEW_RAW.md, removes REVIEW.md
    Given a file ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      ## Notes the human added to REVIEW.md this round

      - [x] ./src/calc.ts#1 — new add function — rename `add` to `sum`
      """
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.collecting"

    # build.review.collecting: raw material → instruction list, deletes the raw file
    Given a file ".gtd/REVIEW_FEEDBACK.md" with:
      """
      1. ./src/calc.ts#1 — rename the exported `add` to `sum`
      """
    And the file ".gtd/REVIEW_RAW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → build.addressing"

    # build.addressing: implements the instruction and deletes the file
    Given "src/calc.ts" is modified to:
      """
      export const sum = (a: number, b: number) => a + b
      """
    And the file ".gtd/REVIEW_FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.addressing → build.health.check"

  Scenario: build.addressing refuses a work-free turn that just deletes the instructions
    Given an empty commit "gtd(human): build.review.await-review → build.review.deciding"
    And a commit "gtd(agent): build.review.collecting → build.addressing" that adds ".gtd/REVIEW_FEEDBACK.md" with:
      """
      1. ./src/calc.ts#1 — rename the exported `add` to `sum`
      """
    # The BUG behaviour: delete the instructions without doing the work
    Given the file ".gtd/REVIEW_FEEDBACK.md" is deleted
    When I run gtd land
    Then it fails
    And stderr contains "without addressing its instructions"

  Scenario: build.addressing allows deleting a NOTHING ACTIONABLE sentinel with no code change
    Given an empty commit "gtd(human): build.review.await-review → build.review.deciding"
    And a commit "gtd(agent): build.review.collecting → build.addressing" that adds ".gtd/REVIEW_FEEDBACK.md" with:
      """
      NOTHING ACTIONABLE — the human left only an approving remark.
      """
    # A non-actionable round makes no code change; deleting the sentinel is fine
    Given the file ".gtd/REVIEW_FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.addressing → build.health.check"

  Scenario: build.review.collecting refuses a silent no-op — raw consumed, nothing written
    Given a commit "gtd(check): build.review.deciding → build.review.collecting" that adds ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      ## Notes the human added to REVIEW.md this round

      - [x] ./src/calc.ts#1 — rename `add` to `sum`
      """
    # Silent no-op: consume the raw file, produce no instruction list
    Given the file ".gtd/REVIEW_RAW.md" is deleted
    When I run gtd land
    Then it fails
    And stderr contains "no declared pattern matches"
