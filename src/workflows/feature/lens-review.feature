@inmem
Feature: the quality lap's findings are triaged before the review

  A judge classifies each `## ` finding the lenses wrote to `.gtd/QUALITY.md`:
  a mechanical one is fixed by the fixer, noise is dropped with its `p` kept in
  a trailer, and a design one becomes a note in `.gtd/REVIEW.md`, with answer
  boxes, in the chunk the reviewer gave it. gtd lists, without tick boxes,
  what was fixed automatically and what was dropped as noise.

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
    And step "build.quality.closing" runs its script
    And step "build.review.carrying" runs its script

  Scenario: a mechanical finding is fixed and listed, noise dropped and listed, a design one noted
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9},{"id":"Q2","answer":"noise","p":0.85},{"id":"Q3","answer":"design","p":0.8}]
      """
    And step "build.fix.quality.fixing" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("subtracts a larger number", () => {})
      """
    And step "build.fix.quality.fixing" deletes ".gtd/QUALITY.md"
    And step "build.health.check" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — where it applies
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/QUALITY.md" does not exist
    And the commit "gtd(judge): build.quality.triage → build.quality.sorting" has a body containing "Gtd-Mark: noise=Q2 p=0.85 add could be a method"
    And ".gtd/REVIEW.md" contains:
      """
      ## AC-1 ignores floating point

      Should subtract round? The criterion does not say.

      In the code:

      - [ ] ./src/calc.ts#2-2 — where it applies

      Tick exactly one:

      - [ ] fix as suggested
      - [ ] won't fix
      - [ ] _your answer_

      ## Fixed automatically

      - subtract has no negative test (
      """
    And ".gtd/REVIEW.md" contains the short hash of the commit "gtd(agent): build.fix.quality.fixing → build.health.check"
    And ".gtd/REVIEW.md" contains:
      """
      ## Dropped as noise

      - add could be a method (p=0.85)
      """
    And ".gtd/REVIEW.md" contains:
      """
      ## Fixed automatically

      - subtract has no negative test (
      """
    And the commit subjects end with:
      """
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.quality.triage
      gtd(judge): build.quality.triage → build.quality.sorting
      gtd(check): build.quality.sorting → build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing → build.health.check
      gtd(check): build.health.check → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: an unsure verdict makes a finding a note, never a fix or a drop
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.5},{"id":"Q2","answer":"noise","p":0.6}]
      """
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## subtract has no negative test

      - [ ] ./src/calc.ts#2-2 — where it applies

      ## add could be a method

      - [ ] ./src/calc.ts#2-2 — where it applies

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — where it applies
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains "## subtract has no negative test"
    And ".gtd/REVIEW.md" contains "## add could be a method"
    And ".gtd/REVIEW.md" contains "## AC-1 ignores floating point"
    And ".gtd/REVIEW.md" does not contain "Fixed automatically"
    And no commit body contains "Gtd-Mark: noise="
    And the commit subjects end with:
      """
      gtd(judge): build.quality.triage → build.quality.sorting
      gtd(check): build.quality.sorting → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: a mechanical finding the fix cap leaves becomes a note
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9},{"id":"Q2","answer":"mechanical","p":0.9},{"id":"Q3","answer":"mechanical","p":0.9}]
      """
    And step "build.fix.quality.fixing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## add could be a method

      A class would read better.
      """
    And step "build.health.check" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## add could be a method

      - [ ] ./src/calc.ts#2-2 — where it applies
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/QUALITY.md" does not exist
    And ".gtd/REVIEW.md" contains:
      """
      ## add could be a method

      _The fixer left this unresolved._

      A class would read better.
      """
    And ".gtd/REVIEW.md" contains "- subtract has no negative test ("
    And ".gtd/REVIEW.md" contains "- AC-1 ignores floating point ("
    And the commit subjects end with:
      """
      gtd(judge): build.quality.triage → build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing → build.health.check
      gtd(check): build.health.check → build.quality.closing
      gtd(check): build.quality.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: a fixer that renames a chunk it leaves counts nothing fixed
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9},{"id":"Q2","answer":"mechanical","p":0.9},{"id":"Q3","answer":"mechanical","p":0.9}]
      """
    And step "build.fix.quality.fixing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## null check in parse()

      Still open.
      """
    And step "build.health.check" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)

      ## subtract has no negative test

      - [ ] ./src/calc.ts#2-2 — where it applies

      ## add could be a method

      - [ ] ./src/calc.ts#2-2 — where it applies

      ## AC-1 ignores floating point

      - [ ] ./src/calc.ts#2-2 — where it applies

      ## null check in parse()

      - [ ] ./src/calc.ts#2-2 — where it applies
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains "## null check in parse()"
    And ".gtd/REVIEW.md" contains "## subtract has no negative test"
    And ".gtd/REVIEW.md" contains "check whether it was fixed"
    And ".gtd/REVIEW.md" does not contain "Fixed automatically"

  Scenario: prose the fixer leaves outside every chunk does not hide its fixes
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9},{"id":"Q2","answer":"mechanical","p":0.9},{"id":"Q3","answer":"mechanical","p":0.9}]
      """
    And step "build.fix.quality.fixing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      All fixed.
      """
    And step "build.health.check" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains "- subtract has no negative test ("
    And ".gtd/REVIEW.md" does not contain "check whether it was fixed"

  Scenario: signing off a review with no notes ends the process
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"noise","p":0.9},{"id":"Q2","answer":"noise","p":0.9},{"id":"Q3","answer":"noise","p":0.9}]
      """
    And step "build.review.closing" runs its script
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)
      """
    When the process is driven
    Then the process rests at "build.review.await-review"
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/REVIEW.md" does not exist
    And the commit subjects end with:
      """
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      gtd(human): build.review.await-review → build.review.closing
      gtd(check): build.review.closing → idle
      """
