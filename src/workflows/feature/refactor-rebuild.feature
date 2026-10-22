# One SDLC path per file, so a changed path reds exactly one fixture — do not merge.
@inmem
Feature: refactor-first writes a refactor note, refactors on its own, then rebuilds

  On a refactor-first judgment the naive pass is never applied. `seam.note`
  reads the whole naive diff and writes `.gtd/REFACTOR-NOTE.md`; the refactor
  lands on its own with the existing suite green; the rebuild re-implements the
  change on the refactored base and lands only once it carries the naive pass's
  acceptance tests and the suite is green. The note reaches both turns.

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

      - AC-1: subtract returns the difference.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.check" changes nothing
    And step "seam.naive" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
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

  Scenario: the refactor note reaches the refactor turn and the rebuild turn
    When the process is driven
    Then the process rests at "seam.note"
    And the resting step's content contains "git show"
    And the resting step's content contains ".gtd/REFACTOR-NOTE.md"
    And "src/calc.ts" does not contain "subtract"

    Given step "seam.note" writes ".gtd/REFACTOR-NOTE.md" with:
      """
      # Refactor note

      Seam: route add through a shared `op(a, b, sign)` in src/calc.ts.
      """
    And step "refactor.deriving" runs its script
    When the process is driven
    Then the process rests at "refactor.building"
    And ".gtd/REFACTOR.md" contains "## Refactor note"
    And ".gtd/REFACTOR.md" contains "shared `op(a, b, sign)`"
    And the resting step's content contains "Refactor note"

    Given step "refactor.building" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => op(a, b, 1)
      """
    And step "refactor.health.check" changes nothing
    And step "refactor.closing" runs its script
    And judge step "refactor.build.review.ranking" answers:
      """
      []
      """
    And step "refactor.build.review.carrying" runs its script
    And step "refactor.build.review.reviewing" writes ".gtd/REVIEW.md" with:
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

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      _critical: judge unsure_

      - [x] ./src/calc.ts#1-2
        add built on the shared op
      """
    When gtd lands
    And the process is driven
    Then the process rests at "implement.building"
    And the resting step's content contains "shared `op(a, b, sign)`"
    And the resting step's content contains "acceptance tests for AC-1"

  Scenario: a note turn that changes anything but the note is refused
    Given step "seam.note" writes "src/calc.ts" with:
      """
      export const sub = 1
      """
    Then driving the process is refused with "refactor-note"

  Scenario: the refactor lands on its own only with the existing suite green
    Given step "seam.note" writes ".gtd/REFACTOR-NOTE.md" with:
      """
      Seam: a shared `op` in src/calc.ts.
      """
    And step "refactor.deriving" runs its script
    And step "refactor.building" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => op(a, b, -1)
      """
    And step "refactor.health.check" writes ".gtd/FEEDBACK.md" with:
      """
      FAIL add(1, 2) returned -1
      """
    When the process is driven
    Then the process rests at "refactor.fix.suite.fixing"

    Given step "refactor.fix.suite.fixing" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => op(a, b, 1)
      """
    And step "refactor.health.check" changes nothing
    And step "refactor.closing" runs its script
    And judge step "refactor.build.review.ranking" answers:
      """
      []
      """
    And step "refactor.build.review.carrying" runs its script
    And step "refactor.build.review.reviewing" writes ".gtd/REVIEW.md" with:
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

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      _critical: judge unsure_

      - [x] ./src/calc.ts#1-2
        add built on the shared op
      """
    When gtd lands
    And the process is driven
    Then the process rests at "implement.building"
    And "src/calc.ts" contains "op(a, b, 1)"
    And "src/calc.ts" does not contain "subtract"
    And the output of gtd "slices" contains "refactor "

  Scenario: the rebuild lands only once it carries the naive pass's acceptance tests, green
    Given step "seam.note" writes ".gtd/REFACTOR-NOTE.md" with:
      """
      Seam: a shared `op` in src/calc.ts.
      """
    And step "refactor.deriving" runs its script
    And step "refactor.building" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => op(a, b, 1)
      """
    And step "refactor.health.check" changes nothing
    And step "refactor.closing" runs its script
    And judge step "refactor.build.review.ranking" answers:
      """
      []
      """
    And step "refactor.build.review.carrying" runs its script
    And step "refactor.build.review.reviewing" writes ".gtd/REVIEW.md" with:
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

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      _critical: judge unsure_

      - [x] ./src/calc.ts#1-2
        add built on the shared op
      """
    When gtd lands
    And the process is driven
    Then the process rests at "implement.building"

    Given step "implement.building" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => op(a, b, 1)
      export const subtract = (a: number, b: number) => op(a, b, -1)
      """
    Then driving the process is refused with "rebuild-acceptance"

    Given step "implement.building" writes "src/acceptance.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And "src/calc.ts" contains "op(a, b, -1)"
    And "src/acceptance.test.ts" contains "[AC-1]"
    And ".gtd/REFACTOR-NOTE.md" does not exist
    And the commit subjects end with:
      """
      gtd(judge): seam.judge → seam.note
      gtd(agent): seam.note → refactor.deriving
      gtd(check): refactor.deriving → refactor.building
      gtd(agent): refactor.building → refactor.health.check
      gtd(check): refactor.health.check → refactor.closing
      gtd(check): refactor.closing → refactor.build.review.reviewing
      gtd(agent): refactor.build.review.reviewing → refactor.build.review.ranking
      gtd(judge): refactor.build.review.ranking → refactor.build.review.carrying
      gtd(check): refactor.build.review.carrying → refactor.build.review.await-review
      gtd(human): refactor.build.review.await-review → refactor.build.review.closing
      gtd(check): refactor.build.review.closing → implement.building
      gtd(agent): implement.building → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      """
    And the output lines of gtd "slices" start with:
      """
      refactor
      feature
      """
