@inmem
Feature: The require-revert guard exempts a relocated plumbing directory (it.stateDir)

  `re-unwind`'s require-revert guard scopes residue to the human's review-round
  commit's own paths, excluding gtd's own plumbing directory
  (`src/StepGuards.ts`'s `isCodePath`). That exemption reads the DECLARED
  directory (`it.stateDir`, an engine-assembled `TemplateContext` field
  rendered from `stateDirOf`) rather than a literal `.gtd/` — a workflow that
  relocates its plumbing via `vars.stateDir` (the bundled template renders its
  `stateDir:` declaration from that var) must not have every review round
  refused forever just because the relocated directory itself differs from the
  review base.

  Scenario: a review round whose human commit touches only the relocated plumbing directory lands at re-unwind with no revert needed
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        stateDir: workflow-state
      """
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    # await-review: the human's own step leaves a note on the review doc and
    # writes a scratch note under the relocated plumbing directory — never
    # real code.
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function — looks fine, but see my note
      """
    And a file "workflow-state/notes.md" with:
      """
      reviewer's scratch note, kept under the relocated plumbing directory
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

    # build.review.deciding: CAPTURES the raw material, removes REVIEW.md
    Given a file ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.
      """
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.collecting"

    # build.review.collecting: classifies the note straight into
    # REQUIREMENTS.md and consumes the raw capture -> the root's own re-unwind
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Note from review

      the reviewer left a note; nothing to revert since the round never
      touched real code.
      """
    And the file ".gtd/REVIEW_RAW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → re-unwind"

    # re-unwind: the human's own review-round commit only touched
    # workflow-state/notes.md — plumbing, per the relocated vars.stateDir
    # above, and never scored as residue. `gtd land` succeeds with the
    # working tree untouched: no revert was ever necessary.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → design.triage"
    And "workflow-state/notes.md" exists

  Scenario: a non-canonical vars.stateDir fails the command, naming the canonical spelling
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        stateDir: a/./state
      """
    When I run gtd next
    Then it fails
    And stderr contains "is not a canonical path"
    And stderr contains "a/state"
