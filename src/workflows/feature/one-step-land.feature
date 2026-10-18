# One SDLC path per file, so a changed path reds exactly one fixture — do not merge.
@inmem
Feature: a naive pass the judge rules land goes straight to implement with no seam gate

  With GTD_FLAG_NAIVE_PASS on and GTD_FLAG_RISK_TIER off, a naive pass that
  edits an existing source file is judged land: the process skips the approval
  gate, any refactor and any architecture, and runs implement, quality and
  review back to idle. The flags are pinned here so the per-flag test runs never
  move it off this path.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
    And an environment variable "GTD_FLAG_NAIVE_PASS" set to "1"
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
      """
    And step "design.gate.answer" changes nothing
    And step "seam.naive" writes "src/greeting.ts" with:
      """
      export const greeting = "Hello, world"
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    And step "implement.building" writes "src/greeting.ts" with:
      """
      export const greeting = "Hello, world!"
      """
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And step "build.quality.correctness.reviewing" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## greeting

      - [ ] ./src/greeting.ts#1-1
        typo fixed
      """
    And step "build.review.closing" runs its script

  Scenario: a land judgment runs idle to idle with no seam gate, refactor or architecture
    When the process is driven
    Then the process rests at "build.review.await-review"
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## greeting

      - [x] ./src/greeting.ts#1-1
        typo fixed
      """
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And "src/greeting.ts" contains "Hello, world!"
    And the commit subjects end with:
      """
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → implement.building
      gtd(agent): implement.building → implement.health.check
      gtd(check): implement.health.check → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      gtd(agent): build.quality.correctness.reviewing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.await-review
      gtd(human): build.review.await-review → build.review.closing
      gtd(check): build.review.closing → idle
      """
    And the commit "gtd(human): idle → unwind" has a body containing "Gtd-Var: flag_naive_pass=1"
    And the commit "gtd(human): idle → unwind" has a body containing "Gtd-Var: flag_risk_tier=0"
    And the commit "gtd(agent): seam.naive → seam.judge" has a body containing "Gtd-Kept:"
    And the commit "gtd(judge): seam.judge → implement.building" has a body containing "\"answer\":\"land\""
    And no commit body contains "Gtd-Approved:"
    And the output lines of gtd "slices" start with:
      """
      feature 
      """
    And no commit body contains "Gtd-Workflow:"
