@inmem
Feature: the quality lap's findings are triaged, then decided at the finding gate

  A judge classifies each `## ` finding the lenses wrote to `.gtd/QUALITY.md`:
  a mechanical one is fixed by the fixer, noise is dropped with its `p` kept in
  a trailer, and a design one is a note. The notes, then the noise under
  `# Dropped as noise`, rest at the finding gate (`build.quality.gate`), each
  with one `- [ ] fix` box: a ticked finding is fixed, an unticked one
  dropped. The review then walks through the code and lists, in one
  `## Quality lap` chunk, what became of every finding.

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

      ## subtract has no negative test

      Add a test subtracting a larger number.

      ## add could be a method

      A class would read better.

      ## AC-1 ignores floating point

      Should subtract round? The criterion does not say.
      """
    And step "build.quality.sorting" runs its script
    And step "build.quality.gating" runs its script
    And step "build.quality.picking" runs its script
    And step "build.quality.closing" runs its script
    And step "build.review.carrying" runs its script
    And step "build.health.check" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — subtract(a, b)
      """

  Scenario: a mechanical finding is fixed, the rest wait at the finding gate, and an untouched gate drops them
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
    When the process is driven
    Then the process rests at "build.quality.gate"
    And the commit "gtd(judge): build.quality.triage → build.quality.sorting" has a body containing "Gtd-Mark: noise=Q2 p=0.85 add could be a method"
    And ".gtd/QUALITY.md" contains:
      """
      ## AC-1 ignores floating point

      _From lens correctness._

      Should subtract round? The criterion does not say.

      - [ ] fix

      # Dropped as noise

      ## add could be a method

      _From lens correctness. The judge called it noise (p=0.85)._

      A class would read better.

      - [ ] fix
      """
    When gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/QUALITY.md" does not exist
    And ".gtd/REVIEW.md" contains:
      """
      ## Quality lap

      What the quality lenses found, and what became of it. Write a note under
      a line to reopen it.

      Fixed automatically:

      - subtract has no negative test (
      """
    And ".gtd/REVIEW.md" contains:
      """
      Dropped at the finding gate:

      - AC-1 ignores floating point (lens correctness)

      Dropped as noise:

      - add could be a method (p=0.85, lens correctness)
      """
    And ".gtd/REVIEW.md" contains the short hash of the commit "gtd(agent): build.fix.quality.fixing → build.health.check"
    And ".gtd/REVIEW.md" does not contain "Tick exactly one:"
    And the commit subjects end with:
      """
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.quality.triage
      gtd(judge): build.quality.triage → build.quality.sorting
      gtd(check): build.quality.sorting → build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing → build.health.check
      gtd(check): build.health.check → build.quality.gating
      gtd(check): build.quality.gating → build.quality.gate
      gtd(human): build.quality.gate → build.quality.closing
      gtd(check): build.quality.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: a ticked note is fixed with the human's guidance, never re-planned
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"noise","p":0.9},{"id":"Q2","answer":"noise","p":0.85},{"id":"Q3","answer":"design","p":0.8}]
      """
    When the process is driven
    Then the process rests at "build.quality.gate"
    Given a file ".gtd/QUALITY.md" with:
      """
      # Quality

      ## AC-1 ignores floating point

      _From lens correctness._

      Should subtract round? The criterion does not say.

      - [x] fix

      Round half up.

      # Dropped as noise

      ## subtract has no negative test

      _From lens correctness. The judge called it noise (p=0.9)._

      Add a test subtracting a larger number.

      - [ ] fix

      ## add could be a method

      _From lens correctness. The judge called it noise (p=0.85)._

      A class would read better.

      - [ ] fix
      """
    When gtd lands
    And the process is driven
    Then the process rests at "build.fix.quality.fixing"
    And ".gtd/QUALITY.md" contains:
      """
      ## AC-1 ignores floating point

      Should subtract round? The criterion does not say.

      Guidance from the human — follow it:

      Round half up.
      """
    And ".gtd/QUALITY.md" does not contain "add could be a method"
    Given step "build.fix.quality.fixing" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => Math.round(a - b)
      """
    And step "build.fix.quality.fixing" deletes ".gtd/QUALITY.md"
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains:
      """
      Fixed at the finding gate:

      - AC-1 ignores floating point (
      """
    And ".gtd/REVIEW.md" contains:
      """
      Dropped as noise:

      - subtract has no negative test (p=0.9, lens correctness)
      - add could be a method (p=0.85, lens correctness)
      """
    And the commit subjects end with:
      """
      gtd(human): build.quality.gate → build.quality.picking
      gtd(check): build.quality.picking → build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing → build.health.check
      gtd(check): build.health.check → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: a finding the judge called noise is rescued by its tick
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"noise","p":0.9},{"id":"Q2","answer":"noise","p":0.85},{"id":"Q3","answer":"noise","p":0.8}]
      """
    And step "build.fix.quality.fixing" deletes ".gtd/QUALITY.md"
    When the process is driven
    Then the process rests at "build.quality.gate"
    Given a file ".gtd/QUALITY.md" with:
      """
      # Quality

      # Dropped as noise

      ## subtract has no negative test

      Add a test subtracting a larger number.

      - [ ] fix

      ## add could be a method

      A class would read better.

      - [x] fix

      ## AC-1 ignores floating point

      Should subtract round? The criterion does not say.

      - [ ] fix
      """
    When gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains:
      """
      Fixed at the finding gate:

      - add could be a method (
      """
    And ".gtd/REVIEW.md" contains:
      """
      Dropped as noise:

      - subtract has no negative test (p=0.9, lens correctness)
      - AC-1 ignores floating point (p=0.8, lens correctness)
      """

  Scenario: guidance under an unticked box is refused
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"noise","p":0.9},{"id":"Q2","answer":"noise","p":0.85},{"id":"Q3","answer":"design","p":0.8}]
      """
    When the process is driven
    Then the process rests at "build.quality.gate"
    Given a file ".gtd/QUALITY.md" with:
      """
      # Quality

      ## AC-1 ignores floating point

      Should subtract round? The criterion does not say.

      - [ ] fix

      Round half up.
      """
    Then landing is refused with "finding-gate: 1 problem(s) in .gtd/QUALITY.md"
    And landing is refused with "has guidance under an unticked box — tick it to fix the finding, or delete the text to drop it"

  Scenario: a ticked finding the fix cap leaves is listed unresolved, with no second gate
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"noise","p":0.9},{"id":"Q2","answer":"noise","p":0.85},{"id":"Q3","answer":"design","p":0.8}]
      """
    And step "build.fix.quality.fixing" changes nothing
    When the process is driven
    Then the process rests at "build.quality.gate"
    Given a file ".gtd/QUALITY.md" with:
      """
      # Quality

      ## AC-1 ignores floating point

      Should subtract round? The criterion does not say.

      - [x] fix
      """
    When gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/QUALITY.md" does not exist
    And ".gtd/REVIEW.md" contains:
      """
      Unresolved after the finding gate:

      - AC-1 ignores floating point (lens correctness)
      """
    And the commit subjects end with:
      """
      gtd(human): build.quality.gate → build.quality.picking
      gtd(check): build.quality.picking → build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing → build.health.check
      gtd(check): build.health.check → build.quality.closing
      gtd(check): build.quality.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: a lap whose every finding was fixed has no gate
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9},{"id":"Q2","answer":"mechanical","p":0.9},{"id":"Q3","answer":"mechanical","p":0.9}]
      """
    And step "build.fix.quality.fixing" deletes ".gtd/QUALITY.md"
    When the process is driven
    Then the process rests at "build.review.await-review"
    And no commit body contains "build.quality.gate"
    And ".gtd/REVIEW.md" contains "- AC-1 ignores floating point ("

  Scenario: a risk is fixed before the human sees the review, re-reviewed in the reviewer's own draft
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9},{"id":"Q2","answer":"noise","p":0.85},{"id":"Q3","answer":"design","p":0.8}]
      """
    And step "build.fix.quality.fixing" deletes ".gtd/QUALITY.md"
    And step "build.quality.gate" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Subtract

      - [ ] ./src/calc.ts#2-2 — Risk: overflows on large numbers
      """
    When the process is driven
    Then the process rests at "build.review.fix.risks.fixing"
    And ".gtd/REVIEW.md" does not contain "## Quality lap"
    Given step "build.review.reviewing" is no longer scripted
    And step "build.review.reviewing" replaces the text "Risk: overflows on large numbers" in ".gtd/REVIEW.md" with "subtract(a, b), now guarded"
    And step "build.review.fix.risks.fixing" changes nothing
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains "subtract(a, b), now guarded"
    And ".gtd/REVIEW.md" contains "## Quality lap" exactly once
    And ".gtd/REVIEW.md" contains "Fixed automatically:" exactly once
    And the commit subjects end with:
      """
      gtd(check): build.quality.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.fix.risks.fixing
      gtd(agent): build.review.fix.risks.fixing → build.health.check
      gtd(check): build.health.check → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: an unsure verdict makes a finding a note, never a fix or a drop
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.5},{"id":"Q2","answer":"noise","p":0.6}]
      """
    When the process is driven
    Then the process rests at "build.quality.gate"
    And ".gtd/QUALITY.md" contains "## subtract has no negative test"
    And ".gtd/QUALITY.md" contains "## add could be a method"
    And ".gtd/QUALITY.md" contains "## AC-1 ignores floating point"
    And ".gtd/QUALITY.md" does not contain "# Dropped as noise"
    And no commit body contains "Gtd-Mark: noise="
    And the commit subjects end with:
      """
      gtd(agent): build.quality.correctness.reviewing → build.quality.triage
      gtd(judge): build.quality.triage → build.quality.gating
      gtd(check): build.quality.gating → build.quality.gate
      """

  Scenario: a mechanical finding the fix cap leaves reaches the gate as unresolved
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
    When the process is driven
    Then the process rests at "build.quality.gate"
    And ".gtd/QUALITY.md" contains:
      """
      ## add could be a method

      _From lens correctness. The fixer left it unresolved._

      A class would read better.

      - [ ] fix
      """
    And the commit subjects end with:
      """
      gtd(judge): build.quality.triage → build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing → build.health.check
      gtd(check): build.health.check → build.quality.gating
      gtd(check): build.quality.gating → build.quality.gate
      """
    When gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains "- subtract has no negative test ("
    And ".gtd/REVIEW.md" contains:
      """
      Dropped at the finding gate:

      - add could be a method (lens correctness)
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
    When the process is driven
    Then the process rests at "build.quality.gate"
    And ".gtd/QUALITY.md" contains "## null check in parse()"
    And ".gtd/QUALITY.md" contains "## subtract has no negative test"
    And ".gtd/QUALITY.md" contains "check whether it was fixed"

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
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains "- subtract has no negative test ("
    And ".gtd/REVIEW.md" does not contain "check whether it was fixed"

  Scenario: signing off the review ends the process
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"noise","p":0.9},{"id":"Q2","answer":"noise","p":0.9},{"id":"Q3","answer":"noise","p":0.9}]
      """
    And step "build.quality.gate" changes nothing
    And step "build.review.closing" runs its script
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

  Scenario: a finding whose entry the human deleted is listed as dropped
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"noise","p":0.9},{"id":"Q2","answer":"noise","p":0.85},{"id":"Q3","answer":"design","p":0.8}]
      """
    When the process is driven
    Then the process rests at "build.quality.gate"
    Given a file ".gtd/QUALITY.md" with:
      """
      # Quality

      # Dropped as noise

      ## add could be a method

      A class would read better.

      - [ ] fix
      """
    When gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains:
      """
      Dropped at the finding gate:

      - AC-1 ignores floating point (lens correctness)

      Dropped as noise:

      - add could be a method (p=0.85, lens correctness)
      - subtract has no negative test (p=0.9, lens correctness)
      """
