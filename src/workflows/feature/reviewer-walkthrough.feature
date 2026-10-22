@inmem
Feature: a reviewer walks the human through the feature's code

  The feature's final review is written by a reviewer turn
  (`build.review.reviewing`): chunks grouped by concern, each pointing at its
  code, so the phone shows it. Every finding the quality laps left gets a chunk
  of its own, headed exactly as the prompt gives it, holding the pointers to the
  code it cites; gtd then adds the finding's text and the answer boxes
  (`build.review.carrying`). A chunk pointing at no code, or a finding left out,
  is refused.

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

      ## AC-1 ignores floating point

      Should subtract round? The criterion does not say.
      """
    And judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"design","p":0.9}]
      """
    And step "build.quality.sorting" runs its script
    And step "build.quality.closing" runs its script
    And step "build.review.carrying" runs its script
    And judge step "build.review.ranking" answers:
      """
      []
      """

  Scenario: the finding gets its text and answer boxes under the reviewer's pointers
    Given step "build.review.reviewing" is prompted with "- `## AC-1 ignores floating point`:"
    And step "build.review.reviewing" is prompted with "> Should subtract round? The criterion does not say."
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      The new export.

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — returns the raw difference
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains:
      """
      ## Subtract

      _critical: judge unsure_

      The new export.

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## AC-1 ignores floating point

      _critical: judge unsure_

      Should subtract round? The criterion does not say.

      In the code:

      - [ ] ./src/calc.ts#2-2 — returns the raw difference

      Tick exactly one:

      - [ ] fix as suggested
      - [ ] won't fix
      - [ ] _your answer_
      """
    And no commit body contains "build.review.composing"
    And the commit subjects end with:
      """
      gtd(agent): build.review.reviewing → build.review.ranking
      gtd(judge): build.review.ranking → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: a chunk pointing at no code is refused
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      The new export, with no pointer.

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — returns the raw difference
      """
    Then driving the process is refused with "Subtract — points at no code"

  Scenario: a finding the reviewer left out is refused
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)
      """
    Then driving the process is refused with "AC-1 ignores floating point — no chunk of its own"

  Scenario: a risk the reviewer marks is fixed before the human sees the review
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — Risk: overflows on large numbers

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — returns the raw difference
      """
    And step "build.review.fix.risks.fixing" changes nothing
    And step "build.health.check" changes nothing
    When the process is driven
    Then the process rests at "build.review.await-review"
    And the commit subjects end with:
      """
      gtd(agent): build.review.reviewing → build.review.ranking
      gtd(judge): build.review.ranking → build.review.carrying
      gtd(check): build.review.carrying → build.review.fix.risks.fixing
      gtd(agent): build.review.fix.risks.fixing → build.health.check
      gtd(check): build.health.check → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.ranking
      gtd(judge): build.review.ranking → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: a standard conflict the reviewer writes itself is refused
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Standard conflict 0123abcd

      - [ ] ./src/calc.ts#2-2 — copied over

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — returns the raw difference
      """
    Then driving the process is refused with "Standard conflict 0123abcd — gtd writes conflicts"

  Scenario: two chunks with one title are refused
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — returns the raw difference
      """
    Then driving the process is refused with "AC-1 ignores floating point — a second chunk with this title"

  Scenario: a risk marked in a finding's chunk is refused, never fixed
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — Risk: no rounding
      """
    Then driving the process is refused with "no `Risk:` in a quality finding's chunk"
