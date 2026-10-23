@inmem
Feature: fix's quality lap is triaged, and its leftovers are decided at the finding gate

  A judge sorts the lap's findings: mechanical ones are fixed for up to three
  turns, and the design ones — with whatever the fix turns left, and the
  noise — wait at the finding gate, never at an escalation. A ticked one is
  fixed on the spot; the hand-off review lists what became of each in its
  summary and carries no finding on to the next `fix`. With no requirements
  to check against, the `criteria-coverage` lens runs no turn.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to "criteria-coverage, correctness"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"
    And a file ".gtd/REVIEW.orig.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        new add function
      """
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        new add function — rename it to sum
      """
    And the working tree is committed as "chore: hand off a review"
    And step "notes.fixing" writes "src/calc.ts" with:
      """
      export const sum = (a: number, b: number) => a + b
      """
    And step "notes.closing" runs its script
    And step "build.health.check" changes nothing
    And step "build.quality.correctness.reviewing" writes ".gtd/QUALITY.md" with:
      """
      # Quality

      ## sum has no negative test

      Add a test summing negative numbers.

      ## sum should be named plus

      The glossary says plus.
      """
    And step "build.quality.sorting" runs its script
    And step "build.quality.gating" runs its script
    And step "build.quality.picking" runs its script
    And step "build.quality.closing" runs its script
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        renamed to sum
      """
    And step "build.review.carrying" runs its script

  Scenario: a design finding and one the fix cap left reach the finding gate, and a ticked one is fixed there
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9},{"id":"Q2","answer":"design","p":0.9}]
      """
    And step "build.fix.quality.fixing" changes nothing
    When gtd opens door "fix"
    And the process is driven
    Then the process rests at "build.quality.gate"
    And no commit body contains "build.health.describe"
    And no commit body contains "build.quality.criteria-coverage"
    And ".gtd/QUALITY.md" contains:
      """
      ## sum should be named plus

      _From lens correctness._

      The glossary says plus.

      - [ ] fix

      ## sum has no negative test

      _From lens correctness. The fixer left it unresolved._

      Add a test summing negative numbers.

      - [ ] fix
      """
    Given a file ".gtd/QUALITY.md" with:
      """
      # Quality

      ## sum should be named plus

      The glossary says plus.

      - [x] fix

      ## sum has no negative test

      Add a test summing negative numbers.

      - [ ] fix
      """
    And step "build.fix.quality.fixing" is no longer scripted
    And step "build.fix.quality.fixing" writes "src/calc.ts" with:
      """
      export const plus = (a: number, b: number) => a + b
      """
    And step "build.fix.quality.fixing" deletes ".gtd/QUALITY.md"
    When gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/QUALITY.md" does not exist
    And ".gtd/REVIEW.md" contains:
      """
      Fixed at the finding gate:

      - sum should be named plus (
      """
    And ".gtd/REVIEW.md" contains:
      """
      Dropped at the finding gate:

      - sum has no negative test (lens correctness)
      """
    And ".gtd/REVIEW.md" does not contain "Tick exactly one:"
    And the commit subjects end with:
      """
      gtd(human): build.quality.gate → build.quality.picking
      gtd(check): build.quality.picking → build.fix.quality.fixing
      gtd(agent): build.fix.quality.fixing → build.health.check
      gtd(check): build.health.check → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: a fixed finding and a noise one are listed in the review
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9},{"id":"Q2","answer":"noise","p":0.9}]
      """
    And step "build.fix.quality.fixing" writes "src/calc.test.ts" with:
      """
      it("sums negative numbers", () => {})
      """
    And step "build.fix.quality.fixing" deletes ".gtd/QUALITY.md"
    And step "build.quality.gate" changes nothing
    When gtd opens door "fix"
    And the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains "Fixed automatically:"
    And ".gtd/REVIEW.md" contains "- sum has no negative test ("
    And ".gtd/REVIEW.md" contains the short hash of the commit "gtd(agent): build.fix.quality.fixing → build.health.check"
    And ".gtd/REVIEW.md" contains "- sum should be named plus (p=0.9, lens correctness)"

  Scenario: a risk the hand-off reviewer marks is fixed and re-reviewed in its own draft, the summary added once
    Given judge step "build.quality.triage" answers:
      """
      [{"id":"Q1","answer":"mechanical","p":0.9},{"id":"Q2","answer":"noise","p":0.9}]
      """
    And step "build.fix.quality.fixing" deletes ".gtd/QUALITY.md"
    And step "build.quality.gate" changes nothing
    And step "build.review.reviewing" is no longer scripted
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1 — Risk: overflows on large numbers
      """
    When gtd opens door "fix"
    And the process is driven
    Then the process rests at "build.review.fix.risks.fixing"
    And ".gtd/REVIEW.md" does not contain "## Quality lap"
    Given step "build.review.reviewing" is no longer scripted
    And step "build.review.reviewing" replaces the text "Risk: overflows on large numbers" in ".gtd/REVIEW.md" with "sum, now guarded"
    And step "build.review.fix.risks.fixing" changes nothing
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REVIEW.md" contains "sum, now guarded"
    And ".gtd/REVIEW.md" contains "## Quality lap" exactly once
    And ".gtd/REVIEW.md" contains "## calc" exactly once
    And the commit subjects end with:
      """
      gtd(check): build.quality.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.fix.risks.fixing
      gtd(agent): build.review.fix.risks.fixing → build.health.check
      gtd(check): build.health.check → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """
