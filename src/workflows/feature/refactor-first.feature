# One SDLC path per file, so a changed path reds exactly one fixture — do not merge.
@inmem
Feature: a refactor-first judgment walks one fixed path to the review gate

  With GTD_FLAG_RISK_TIER off, a naive pass touching
  an existing non-allowlisted file is ruled refactor-first, is refactored and
  that refactor reviewed, and only then implemented and brought to the feature review. The flags are
  pinned so the per-flag test runs never move it off its path.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_PROTOTYPEROUNDS" set to "0"
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_REFACTORQUALITYREVIEWS" set to ""
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

  Scenario: a refactor-first judgment runs refactor, its review, implement and the quality lap to the feature review
    Given step "seam.check" changes nothing
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
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And step "seam.note" writes ".gtd/REFACTOR-NOTE.md" with:
      """
      Seam: the existing code the strays touch.
      """
    And step "refactor.deriving" runs its script
    When the process is driven
    Then the process rests at "refactor.building"
    And ".gtd/REFACTOR.md" contains "calc.ts`"

    Given step "refactor.building" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => op(a, b, 1)
      """
    And step "refactor.health.check" changes nothing
    And step "refactor.closing" runs its script
    And step "refactor.build.review.composing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-2
        add built on the shared op
      """
    And step "refactor.build.review.closing" runs its script
    When the process is driven
    Then the process rests at "refactor.build.review.await-review"
    And ".gtd/REFACTOR.md" does not exist

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [x] ./src/calc.ts#1-2
        add built on the shared op
      """
    When gtd lands
    And the process is driven
    Then the process rests at "implement.building"
    And "src/calc.ts" contains "op(a, b, 1)"

    Given step "implement.building" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => op(a, b, 1)
      export const subtract = (a: number, b: number) => op(a, b, -1)
      """
    And step "implement.building" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And "src/calc.ts" contains "op(a, b, 1)"
    And "src/calc.ts" contains "subtract"
    And the commit subjects end with:
      """
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
      gtd(human): design.gate.answer → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → seam.judge
      gtd(judge): seam.judge → seam.note
      gtd(agent): seam.note → refactor.deriving
      gtd(check): refactor.deriving → refactor.building
      gtd(agent): refactor.building → refactor.health.check
      gtd(check): refactor.health.check → refactor.closing
      gtd(check): refactor.closing → refactor.build.review.composing
      gtd(check): refactor.build.review.composing → refactor.build.review.await-review
      gtd(human): refactor.build.review.await-review → refactor.build.review.closing
      gtd(check): refactor.build.review.closing → implement.building
      gtd(agent): implement.building → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      """
    And the commit "gtd(human): idle → unwind" has a body containing "Gtd-Var: flag_risk_tier=0"
    And the commit "gtd(agent): seam.naive → seam.check" has a body containing "Gtd-Kept:"
    And the commit "gtd(judge): seam.judge → seam.note" has a body containing "\"answer\":\"refactor-first\""
    And no commit body contains "Gtd-Approved:"
    And the output lines of gtd "slices" start with:
      """
      refactor 
      feature 
      """
    And no commit body contains "Gtd-Workflow:"
