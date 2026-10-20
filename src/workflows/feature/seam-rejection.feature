# One SDLC path per file, so a changed path reds exactly one fixture — do not merge.
@inmem
Feature: rejected naive passes walk one fixed path through the steer gate to the review gate

  With GTD_FLAG_RISK_TIER off, three rejected naive
  passes rest at the steer gate, where a human edit restarts the seam and the
  steered rerun lands. The flags are pinned so the per-flag test runs never
  move it off its path.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_RISK_TIER" set to "0"
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

      - AC-1: the change behaves as described.
      """
    And step "design.gate.answer" changes nothing

  Scenario: three rejects rest at the steer gate, a steered rerun lands and runs to the review gate
    Given step "seam.check" changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => b + a
      """
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    When the process is driven
    Then the process rests at "seam.judge"

    Given step "seam.naive" is prompted with "Your previous attempt was rejected"
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"reject","p":0.9}]
      """
    When the process is driven
    Then the process rests at "seam.steer"
    And the resting step's content contains "Overrule"
    And the resting step's content contains "src/calc.ts"

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Concerns

      ### Subtract

      - `subtract(a, b)` returns `a - b`, in the calculator module.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And step "seam.naive" from now on changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    And step "implement.applying" runs its script
    When gtd lands
    And the process is driven
    Then the process rests at "build.review.composing"
    And the commit subjects end with:
      """
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → seam.steer
      gtd(human): seam.steer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.review.composing
      """
    And the commit "gtd(human): idle → unwind" has a body containing "Gtd-Var: flag_risk_tier=0"
    And the commit "gtd(agent): seam.naive → seam.check" has a body containing "Gtd-Kept:"
    And the commit "gtd(judge): seam.judge → seam.naive" has a body containing "\"answer\":\"reject\""
    And the commit "gtd(judge): seam.judge → seam.steer" has a body containing "\"answer\":\"reject\""
    And the commit "gtd(judge): seam.judge → implement.applying" has a body containing "\"answer\":\"land\""
    And no commit body contains "Gtd-Approved:"
    And the output lines of gtd "slices" start with:
      """
      feature 
      """
    And no commit body contains "Gtd-Workflow:"
