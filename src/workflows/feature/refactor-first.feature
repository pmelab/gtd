# One SDLC path per file, so a changed path reds exactly one fixture — do not merge.
@inmem
Feature: a refactor-first judgment walks one fixed path to idle

  With GTD_FLAG_NAIVE_PASS on and GTD_FLAG_RISK_TIER off, a naive pass touching
  an existing non-allowlisted file is ruled refactor-first, rests at the
  approval gate, and is refactored before it is implemented. The flags are
  pinned so the per-flag test runs never move it off its path.

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

  Scenario: a refactor-first judgment runs approval, refactor, implement and review to idle
    Given step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And step "refactor.deriving" runs its script
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-3
        subtract built on the shared op
      """
    And step "build.review.closing" runs its script
    When the process is driven
    Then the process rests at "seam.approve"
    And the resting step's content contains "src/calc.ts"

    When gtd lands
    And the process is driven
    Then the process rests at "refactor.building"
    And ".gtd/REFACTOR.md" contains "calc.ts`"

    Given step "refactor.building" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => op(a, b, 1)
      """
    And step "refactor.health.check" changes nothing
    And step "refactor.closing" runs its script
    When the process is driven
    Then the process rests at "implement.building"
    And ".gtd/REFACTOR.md" does not exist
    And "src/calc.ts" contains "op(a, b, 1)"

    Given step "implement.building" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => op(a, b, 1)
      export const subtract = (a: number, b: number) => op(a, b, -1)
      """
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    When the process is driven
    Then the process rests at "build.review.await-review"

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [x] ./src/calc.ts#1-3
        subtract built on the shared op
      """
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And "src/calc.ts" contains "op(a, b, 1)"
    And "src/calc.ts" contains "subtract"
    And the commit subjects end with:
      """
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.judge
      gtd(judge): seam.judge → seam.approve
      gtd(human): seam.approve → refactor.deriving
      gtd(check): refactor.deriving → refactor.building
      gtd(agent): refactor.building → refactor.health.check
      gtd(check): refactor.health.check → refactor.closing
      gtd(check): refactor.closing → implement.building
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
    And the commit "gtd(judge): seam.judge → seam.approve" has a body containing "\"answer\":\"refactor-first\""
    And the commit "gtd(human): seam.approve → refactor.deriving" has a body containing "Gtd-Approved: {\"step\":\"seam.approve#1\",\"name\":\"Test\",\"email\":\"test@test.com\"}"
    And no commit body contains "Gtd-Workflow:"
