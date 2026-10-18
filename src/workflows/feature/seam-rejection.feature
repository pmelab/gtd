# One SDLC path per file, so a changed path reds exactly one fixture — do not merge.
@inmem
Feature: rejected naive passes walk one fixed path through the steer gate to idle

  With GTD_FLAG_NAIVE_PASS on and GTD_FLAG_RISK_TIER off, three rejected naive
  passes rest at the steer gate, where a human edit restarts the seam and the
  steered rerun lands. The flags are pinned so the per-flag test runs never
  move it off its path.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_NAIVE_PASS" set to "1"
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
      """
    And step "design.gate.answer" changes nothing

  Scenario: three rejects rest at the steer gate, a steered rerun lands and runs to idle
    Given step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => b + a
      """
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-2
        subtract added
      """
    And step "build.review.closing" runs its script
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
      """
    And step "seam.naive" from now on changes nothing
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    And step "implement.building" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      export const SUBTRACT = true
      """
    When gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [x] ./src/calc.ts#1-2
        subtract added
      """
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And the commit subjects end with:
      """
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → seam.steer
      gtd(human): seam.steer → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → implement.building
      gtd(agent): implement.building → implement.health.check
      gtd(check): implement.health.check → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.await-review
      gtd(human): build.review.await-review → build.review.closing
      gtd(check): build.review.closing → idle
      """
    And the commit "gtd(human): idle → unwind" has a body containing "Gtd-Var: flag_naive_pass=1"
    And the commit "gtd(human): idle → unwind" has a body containing "Gtd-Var: flag_risk_tier=0"
    And the commit "gtd(agent): seam.naive → seam.judge" has a body containing "Gtd-Kept:"
    And the commit "gtd(judge): seam.judge → seam.naive" has a body containing "\"answer\":\"reject\""
    And the commit "gtd(judge): seam.judge → seam.steer" has a body containing "\"answer\":\"reject\""
    And the commit "gtd(judge): seam.judge → implement.building" has a body containing "\"answer\":\"land\""
    And no commit body contains "Gtd-Approved:"
    And the output lines of gtd "slices" start with:
      """
      feature 
      """
    And no commit body contains "Gtd-Workflow:"
