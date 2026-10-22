@inmem
Feature: every note in the review is answered with one tick

  Each quality note in `.gtd/REVIEW.md` ends in three boxes — fix as
  suggested, won't fix, or the human's own answer written over the
  placeholder. The gate refuses to land until every note holds exactly one
  tick. A fix goes to the nit batch, a won't-fix is dropped and recorded in
  the gate's commit, an own answer is judged like any other note. Nothing is
  deferred to `.gtd/TODO.md`.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
    And an environment variable "GTD_FLAGMODE" set to "false"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"
    And a file "TODO.md" with:
      """
      # Add subtract

      subtract(a, b) returns the difference.
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Concerns

      ### Subtract

      - `subtract(a, b)` returns `a - b`.

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "seam.check" changes nothing
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    And step "build.quality.correctness.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## subtract has no negative test

      Add a test subtracting a larger number.

      ## add could be a method

      A class would read better.

      ## AC-1 ignores floating point

      Should subtract round? The criterion does not say.
      """
    And step "build.quality.sorting" runs its script
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)
      """
    And step "build.review.reviewing", when prompted with "- `## AC-1 ignores floating point`", writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — returns the raw difference
      """
    And step "build.review.reviewing", when prompted with "worked on the human's nits", writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — now rounds the difference
      """
    And step "build.review.carrying" runs its script
    And judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"noise","p":0.9},{"id":"Q2","answer":"noise","p":0.9},{"id":"Q3","answer":"design","p":0.9}]
      """
    And step "build.review.closing" runs its script

  Scenario: the note ends in its three answer boxes
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains:
      """
      ## AC-1 ignores floating point

      Should subtract round? The criterion does not say.

      - [ ] ./src/calc.ts#2-2 — returns the raw difference

      Tick exactly one:

      - [ ] fix as suggested
      - [ ] won't fix
      - [ ] _your answer_
      """

  Scenario: a sign-off with the note unanswered is refused
    When the process is driven
    Then landing is refused with "answer-completeness: 1 note(s) in .gtd/REVIEW.md not answered"
    And the process rests at "build.review.await-review"

  Scenario: two ticks on one note are refused
    When the process is driven
    And the text "- [ ] fix as suggested" in ".gtd/REVIEW.md" is replaced with "- [x] fix as suggested"
    And the text "- [ ] won't fix" in ".gtd/REVIEW.md" is replaced with "- [x] won't fix"
    Then landing is refused with "tick exactly one box per note"

  Scenario: a ticked answer still holding the placeholder is refused
    When the process is driven
    And the text "- [ ] _your answer_" in ".gtd/REVIEW.md" is replaced with "- [x] _your answer_"
    Then landing is refused with "answer-completeness"

  Scenario: won't fix drops the note, records it, and signs off
    Given judge step "build.review.standards.judge" answers:
      """
      [{"id":"standard-1","answer":"no","p":0.9}]
      """
    When the process is driven
    And the text "- [ ] won't fix" in ".gtd/REVIEW.md" is replaced with "- [x] won't fix"
    And gtd lands
    And the process is driven
    Then the process rests at "idle"
    And the commit "gtd(human): build.review.await-review → build.review.standards.judge" has a body containing "Gtd-Mark: wontfix=AC-1 ignores floating point"
    And ".gtd/TODO.md" does not exist
    And no commit body contains "build.review.triage"

  Scenario: fix as suggested goes to the nit batch unjudged, and the note is not asked again
    Given step "build.review.fix.nits.fixing" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => Math.round(a - b)
      """
    And step "build.review.fix.nits.fixing" is prompted with "Should subtract round?"
    And step "build.health.check" changes nothing
    When the process is driven
    And the text "- [ ] fix as suggested" in ".gtd/REVIEW.md" is replaced with "- [x] fix as suggested"
    And gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And no commit body contains "build.review.triage"
    And ".gtd/REVIEW.md" contains "now rounds the difference"
    And ".gtd/REVIEW.md" does not contain "AC-1 ignores floating point"
    And ".gtd/TODO.md" does not exist
    When gtd lands
    And the process is driven
    Then the process rests at "idle"

  Scenario: an own answer is judged like a note
    Given judge step "build.review.standards.judge" answers:
      """
      [{"id":"standard-1","answer":"no","p":0.9}]
      """
    And judge step "build.review.triage" answers:
      """
      [{"id":"answer-1","answer":"nit","p":0.9}]
      """
    And step "build.review.fix.nits.fixing" is prompted with "round half up"
    And step "build.health.check" changes nothing
    And step "build.review.fix.nits.fixing" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => Math.round(a - b)
      """
    When the process is driven
    And the text "- [ ] _your answer_" in ".gtd/REVIEW.md" is replaced with "- [x] round half up"
    And gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And the commit subjects end with:
      """
      gtd(human): build.review.await-review → build.review.standards.judge
      gtd(judge): build.review.standards.judge → build.review.triage
      gtd(judge): build.review.triage → build.review.fix.nits.fixing
      gtd(agent): build.review.fix.nits.fixing → build.health.check
      gtd(check): build.health.check → build.review.closing
      gtd(check): build.review.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """
    And ".gtd/REVIEW.md" does not contain "AC-1 ignores floating point"

  Scenario: deleting a note's boxes instead of answering is refused
    When the process is driven
    And the text "- [ ] fix as suggested" in ".gtd/REVIEW.md" is replaced with ""
    And the text "Tick exactly one:" in ".gtd/REVIEW.md" is replaced with ""
    Then landing is refused with "its answer boxes were deleted"
