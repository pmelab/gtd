@inmem
Feature: a reviewer walks the human through the feature's code

  The feature's final review is written by a reviewer turn
  (`build.review.reviewing`): chunks grouped by concern, each pointing at its
  code, so the phone shows it. The quality lap's findings were decided at the
  finding gate: the reviewer is told nothing of them, and gtd only appends
  the lap's summary (`build.review.carrying`). A chunk pointing at no code is
  refused.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
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

      ## Impact

      - the greeting module

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

  Scenario: the review is the reviewer's walkthrough, as it wrote it
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      The new export.

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And the resting step's content does not contain "Tick exactly one"
    And ".gtd/REVIEW.md" contains:
      """
      <!-- base: 0000000 -->

      ## Subtract

      The new export.

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)
      """
    And the commit subjects end with:
      """
      gtd(check): implement.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.await-review
      """

  Scenario: a chunk pointing at no code is refused
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      The new export, with no pointer.
      """
    Then driving the process is refused with "Subtract — points at no code"

  Scenario: a review the reviewer sorts into sections itself is refused
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Walkthrough

      ### Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)
      """
    Then driving the process is refused with "Walkthrough — write `## ` chunks only"

  Scenario: a standard conflict the reviewer writes itself is refused
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Standard conflict 0123abcd

      - [ ] ./src/calc.ts#2-2 — copied over
      """
    Then driving the process is refused with "Standard conflict 0123abcd — gtd writes conflicts"

  Scenario: two chunks with one title are refused
    Given step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — returns the raw difference
      """
    Then driving the process is refused with "Subtract — a second chunk with this title"
