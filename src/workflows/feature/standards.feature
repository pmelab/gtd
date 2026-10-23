@inmem
Feature: the review learns standards from the human's answers

  A won't-fix tick or an own answer at the review gate is a candidate
  standard. A judge asks whether it is reusable; above `standardMinP` it is
  kept in `.gtd/STANDARDS.md` with no further question, and every later agent
  turn — lenses and coder alike — is told to follow it. One that contradicts
  a standard already kept becomes a note in `.gtd/REVIEW.md` the review cannot
  sign off without: keep the new one, keep the old one, or write the merged
  wording.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_PROTOTYPEROUNDS" set to "0"
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
    And step "build.quality.correctness.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## subtract has no class

      Calculators read better as classes.
      """
    And step "build.quality.sorting" runs its script
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)
      """
    And step "build.review.reviewing", when prompted with "- `## subtract has no class`", writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## subtract has no class

      - [ ] ./src/calc.ts#2-2 — a plain function
      """
    And step "build.review.carrying" runs its script
    And judge step "build.review.ranking" answers:
      """
      []
      """
    And judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"design","p":0.9}]
      """
    And step "build.review.closing" runs its script
    And step "build.review.standards.recording" runs its script
    And step "build.review.standards.raising" runs its script

  Scenario: a won't-fix the judge calls reusable is kept, and the review signs off
    Given judge step "build.review.standards.judge" answers:
      """
      [{"id":"standard-1","answer":"yes","p":0.9}]
      """
    When the process is driven
    And the text "- [ ] won't fix" in ".gtd/REVIEW.md" is replaced with "- [x] won't fix"
    And gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/STANDARDS.md" contains:
      """
      - Won't fix: subtract has no class — Calculators read better as classes.
      """
    And the commit subjects end with:
      """
      gtd(human): build.review.await-review → build.review.standards.judge
      gtd(judge): build.review.standards.judge → build.review.standards.recording
      gtd(check): build.review.standards.recording → build.review.closing
      gtd(check): build.review.closing → idle
      """

  Scenario: the next review lists the standards added
    Given judge step "build.review.standards.judge" answers:
      """
      [{"id":"standard-1","answer":"yes","p":0.9}]
      """
    And judge step "build.review.triage" answers:
      """
      [{"id":"answer-1","answer":"nit","p":0.9}]
      """
    And step "build.review.fix.nits.fixing" writes "src/calc.ts" with:
      """
      export function add(a: number, b: number) { return a + b }
      export function subtract(a: number, b: number) { return a - b }
      """
    And step "build.health.check" changes nothing
    When the process is driven
    And the text "- [ ] _your answer_" in ".gtd/REVIEW.md" is replaced with "- [x] Calculators are plain functions."
    And gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains:
      """
      ## Standards added

      Learned from your answers and kept in `.gtd/STANDARDS.md`:

      - Calculators are plain functions. (re: subtract has no class)
      """

  Scenario: an answer below the threshold is not kept
    Given judge step "build.review.standards.judge" answers:
      """
      [{"id":"standard-1","answer":"yes","p":0.6}]
      """
    When the process is driven
    And the text "- [ ] won't fix" in ".gtd/REVIEW.md" is replaced with "- [x] won't fix"
    And gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/STANDARDS.md" does not exist

  Scenario: a kept standard reaches the lenses and the coder of a later process
    Given a file ".gtd/STANDARDS.md" with:
      """
      # Standards

      - Won't fix: subtract has no class — Calculators read better as classes.
      """
    And the working tree is committed as "chore: keep a standard"
    And a file "TODO.md" with:
      """
      # Add subtract

      Please add subtract(a, b).
      """
    And step "seam.naive" is prompted with "- Won't fix: subtract has no class"
    And step "build.quality.correctness.reviewing" is prompted with "- Won't fix: subtract has no class"
    When the process is driven
    Then the process rests at "build.review.await-review"

  Scenario: a contradicting standard blocks sign-off until the human picks one
    Given a file ".gtd/STANDARDS.md" with:
      """
      # Standards

      - Calculators are classes.
      """
    And the working tree is committed as "chore: keep a standard"
    And a file "TODO.md" with:
      """
      # Add subtract

      Please add subtract(a, b).
      """
    And judge step "build.review.standards.judge" answers:
      """
      [{"id":"standard-1","answer":"yes","p":0.9},{"id":"standard-1.contradicts-1","answer":"yes","p":0.8}]
      """
    And judge step "build.review.triage" answers:
      """
      [{"id":"answer-1","answer":"praise","p":0.9}]
      """
    When the process is driven
    And the text "- [ ] _your answer_" in ".gtd/REVIEW.md" is replaced with "- [x] Calculators are plain functions."
    And gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/STANDARDS.md" contains:
      """
      - Calculators are classes.

      ## Undecided

      - Calculators are plain functions. (re: subtract has no class)
        - contradicts: Calculators are classes.
      """
    And ".gtd/REVIEW.md" contains "## Standard conflict "
    And ".gtd/REVIEW.md" contains:
      """
      New: Calculators are plain functions. (re: subtract has no class)

      Old:

      - Calculators are classes.

      Tick exactly one:

      - [ ] keep the new one (drop the old)
      - [ ] keep the old one (discard the new)
      - [ ] _your answer_
      """
    And ".gtd/REVIEW.md" does not contain "## subtract has no class"
    And landing is refused with "answer-completeness: 1 note(s) in .gtd/REVIEW.md not answered"
    When the text "- [ ] keep the new one (drop the old)" in ".gtd/REVIEW.md" is replaced with "- [x] keep the new one (drop the old)"
    And gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/STANDARDS.md" contains "- Calculators are plain functions. (re: subtract has no class)"
    And ".gtd/STANDARDS.md" does not contain "Calculators are classes."
    And ".gtd/STANDARDS.md" does not contain "Undecided"

  Scenario: keeping the old standard discards the new one
    Given a file ".gtd/STANDARDS.md" with:
      """
      # Standards

      - Calculators are classes.
      """
    And the working tree is committed as "chore: keep a standard"
    And a file "TODO.md" with:
      """
      # Add subtract

      Please add subtract(a, b).
      """
    And judge step "build.review.standards.judge" answers:
      """
      [{"id":"standard-1","answer":"yes","p":0.9},{"id":"standard-1.contradicts-1","answer":"yes","p":0.8}]
      """
    When the process is driven
    And the text "- [ ] won't fix" in ".gtd/REVIEW.md" is replaced with "- [x] won't fix"
    And gtd lands
    And the process is driven
    And the text "- [ ] keep the old one (discard the new)" in ".gtd/REVIEW.md" is replaced with "- [x] keep the old one (discard the new)"
    And gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/STANDARDS.md" contains:
      """
      # Standards

      Kept from your review answers for every agent turn. One standard per bullet.

      - Calculators are classes.
      """
    And ".gtd/STANDARDS.md" does not contain "Won't fix"

  Scenario: an own answer to a conflict replaces both with its wording
    Given a file ".gtd/STANDARDS.md" with:
      """
      # Standards

      - Calculators are classes.
      """
    And the working tree is committed as "chore: keep a standard"
    And a file "TODO.md" with:
      """
      # Add subtract

      Please add subtract(a, b).
      """
    And judge step "build.review.standards.judge" answers:
      """
      [{"id":"standard-1","answer":"yes","p":0.9},{"id":"standard-1.contradicts-1","answer":"yes","p":0.8}]
      """
    When the process is driven
    And the text "- [ ] won't fix" in ".gtd/REVIEW.md" is replaced with "- [x] won't fix"
    And gtd lands
    And the process is driven
    And the text "- [ ] _your answer_" in ".gtd/REVIEW.md" is replaced with "- [x] Calculators with state are classes."
    And gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/STANDARDS.md" contains "- Calculators with state are classes."
    And ".gtd/STANDARDS.md" does not contain "- Calculators are classes."
    And ".gtd/STANDARDS.md" does not contain "Won't fix"
