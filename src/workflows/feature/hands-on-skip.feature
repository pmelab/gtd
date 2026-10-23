@inmem
Feature: the hands-on test tries only the criteria a person can observe

  Design may tag a criterion no person can try by using the change — prompt
  wording, internal wiring — by writing `(no hands-on)` between its ID and the
  colon. At every hands-on test, implement.prototype.observable asks a judge,
  per untagged criterion, whether a person can observe it by using the
  software; a tagged one is never asked about. Every ID it does not answer
  `no` reaches implement.prototype.testing, which must report each once and
  needs no chunk for the rest. A slice with no such criterion is not tested by hand, and
  nothing rests to say so.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAGMODE" set to "false"
    And an environment variable "GTD_SLICEMAXCRITERIA" set to "2"
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
    And step "design.gate.answer" changes nothing
    And step "seam.check" changes nothing
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script

  Scenario: the testing turn skips a tagged criterion, which the judge is never asked about
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2 (no hands-on): the build prompt names subtract.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("[AC-2] names subtract", () => {})
      """
    And judge step "implement.prototype.observable", when its questions contain "criterion AC-2 describes", answers:
      """
      [{"id":"AC-1","answer":"no","p":0.9},{"id":"AC-2","answer":"no","p":0.9}]
      """
    And judge step "implement.prototype.observable", when its questions contain "criterion AC-1 describes", answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    And step "implement.prototype.testing" is prompted with "Skip AC-2: no person can observe them"
    And step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.
      """
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And the commit subjects end with:
      """
      gtd(check): implement.health.check → implement.prototype.observable
      gtd(judge): implement.prototype.observable → implement.prototype.testing
      gtd(agent): implement.prototype.testing → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      """

  Scenario: a criterion the judge finds no person can observe is skipped like a tagged one
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: add is unchanged.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("[AC-2] adds", () => {})
      """
    And judge step "implement.prototype.observable" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"no","p":0.9}]
      """
    And step "implement.prototype.testing" is prompted with "Skip AC-2: no person can observe them"
    And step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.
      """
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And the commit subjects end with:
      """
      gtd(judge): implement.prototype.observable → implement.prototype.testing
      gtd(agent): implement.prototype.testing → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      """

  Scenario: a criterion the judge gives no verdict on is tested by hand
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: add is unchanged.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("[AC-2] adds", () => {})
      """
    And judge step "implement.prototype.observable" answers:
      """
      [{"id":"AC-2","answer":"no","p":0.9}]
      """
    And step "implement.prototype.testing" is prompted with "Skip AC-2: no person can observe them"
    And step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.
      """
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And the commit subjects end with:
      """
      gtd(judge): implement.prototype.observable → implement.prototype.testing
      gtd(agent): implement.prototype.testing → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      """

  Scenario: a judge landing without a verdict tests every untagged criterion by hand
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: add is unchanged.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("[AC-2] adds", () => {})
      """
    And judge step "implement.prototype.observable" answers:
      """
      []
      """
    And step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.
      """
    Then driving the process is refused with "exactly one chunk headed `## <ID>: pass|fail|blocked` for AC-2"

  Scenario: a report missing a criterion the judge found observable is refused
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: subtract prints a warning for negative results.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      it("[AC-2] warns", () => {})
      """
    And judge step "implement.prototype.observable" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"yes","p":0.9}]
      """
    And step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.
      """
    Then driving the process is refused with "exactly one chunk headed `## <ID>: pass|fail|blocked` for AC-2"

  Scenario: a change with no observable criterion skips the hands-on test without resting
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: add is unchanged.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] adds", () => {})
      """
    And judge step "implement.prototype.observable" answers:
      """
      [{"id":"AC-1","answer":"no","p":0.9}]
      """
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And the commit subjects end with:
      """
      gtd(check): implement.health.check → implement.prototype.observable
      gtd(judge): implement.prototype.observable → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      """

  Scenario: a change whose every criterion is tagged is not tested by hand or judged
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1 (no hands-on): the build prompt names subtract.
      - AC-2 (no hands-on): the review prompt names subtract.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] names subtract in the build", () => {})
      it("[AC-2] names subtract in the review", () => {})
      """
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And the commit subjects end with:
      """
      gtd(check): implement.health.check → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      """

  Scenario: each slice's hands-on test judges its own criteria afresh
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2 (no hands-on): the build prompt names subtract.
      - AC-3: the review prompt names subtract.
      """
    And step "design.slicing" writes ".gtd/SLICES.md" with:
      """
      # Slices

      ## Prompts

      - AC-2
      - AC-3

      ## Subtract

      - AC-1
      """
    And step "seam.naive", when prompted with "This slice builds AC-2, AC-3 only", writes "src/prompts.test.ts" with:
      """
      it("[AC-2] names subtract in the build", () => {})
      it("[AC-3] names subtract in the review", () => {})
      """
    And step "seam.naive", when prompted with "This slice builds AC-1 only", writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And judge step "implement.prototype.observable", when its questions contain "criterion AC-3 describes", answers:
      """
      [{"id":"AC-3","answer":"no","p":0.9}]
      """
    And judge step "implement.prototype.observable", when its questions contain "criterion AC-1 describes", answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    And step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.
      """
    When the process is driven
    Then the process rests at "build.review.reviewing"
    And the commit subjects end with:
      """
      gtd(check): implement.health.check → implement.prototype.observable
      gtd(judge): implement.prototype.observable → implement.closing
      gtd(check): implement.closing → seam.naive
      gtd(agent): seam.naive → seam.check
      gtd(check): seam.check → implement.applying
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.prototype.observable
      gtd(judge): implement.prototype.observable → implement.prototype.testing
      gtd(agent): implement.prototype.testing → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      """

  Scenario: the tag is frozen once design is settled
    Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And judge step "implement.prototype.observable" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    And step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: fail

      Printed 4.
      """
    And step "implement.prototype.fix.fixing" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1 (no hands-on): subtract(a, b) returns a - b.
      """
    Then driving the process is refused with "criteria-frozen"
