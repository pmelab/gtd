# One SDLC path per file, so a changed path reds exactly one fixture — do not merge.
@inmem
Feature: a naive pass the judge rules land is itself the implementation

  With GTD_FLAG_RISK_TIER off, a naive pass that
  edits an existing source file is judged land: the process skips the approval
  gate and any refactor, applies the kept pass as it is — no build turn — and
  runs the health loop and quality lap to the feature review. The flag is pinned here so the per-flag test runs never
  move it off this path.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
    And an environment variable "GTD_FLAG_RISK_TIER" set to "0"
    And a file "src/greeting.ts" with:
      """
      export const greeting = "Helo, world"
      """
    And the working tree is committed as "feat: add greeting"
    And a file "TODO.md" with:
      """
      # Fix the typo

      greeting says "Helo"; make it "Hello".
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Concerns

      ### Typo

      - greeting reads "Hello, world".

      ## Impact

      - the greeting module

      ## Release Flag

      new

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.check" changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/greeting.ts" with:
      """
      export const greeting = "Hello, world"
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And step "build.quality.correctness.reviewing" changes nothing

  Scenario: a land judgment applies the naive pass and runs from idle to the review gate with no rebuild
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And "src/greeting.ts" contains "Hello, world"
    And "src/acceptance.test.ts" contains "[AC-1] holds"
    And the commit subjects end with:
      """
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.review.reviewing
      """
    And the commit "gtd(human): idle → unwind" has a body containing "Gtd-Var: flag_risk_tier=0"
    And the commit "gtd(agent): seam.naive → seam.check" has a body containing "Gtd-Kept:"
    And the commit "gtd(judge): seam.judge → implement.applying" has a body containing "\"answer\":\"land\""
    And no commit body contains "Gtd-Approved:"
    And no commit body contains "Gtd-Workflow:"
