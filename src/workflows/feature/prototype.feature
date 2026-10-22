@inmem
Feature: every criterion is tested by hand before the quality lap

  Once coverage is judged, implement.prototype.testing uses the slice the way
  a person would and writes .gtd/PROTOTYPE.md, one chunk per criterion headed
  `## AC-<n>: pass|fail|blocked`, plus one per problem found beside them. A
  failure goes to implement.prototype.fix.fixing and is tested again; only a clean
  report closes the slice. Past `prototypeRounds` fix rounds, or with nothing a
  fixer can take, a person decides at implement.prototype.open.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
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

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      - AC-2: add is unchanged.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a + b
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => expect(subtract(3, 1)).toBe(2))
      it("[AC-2] adds", () => expect(add(1, 1)).toBe(2))
      """
    And step "seam.check" changes nothing
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"yes","p":0.9}]
      """
    And step "implement.closing" runs its script

  Scenario: the testing turn is told to use every criterion for real, in a disposable place
    When the process is driven
    Then the process rests at "implement.prototype.testing"
    And the last commit subject is "gtd(judge): implement.coverage → implement.prototype.testing"
    And the resting step's content contains "Running the test suite is not this"
    And the resting step's content contains "against the user's real data or this working tree"
    And the resting step's content contains "`## AC-<n>: pass`"

  Scenario: a clean report closes the slice and moves on to the quality lap
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      # Prototype test

      ## AC-1: pass

      Ran `node -e 'console.log(subtract(3, 1))'` in a scratch directory; printed 2.

      ## AC-2: pass

      Ran `node -e 'console.log(add(1, 1))'`; printed 2.
      """
    When the process is driven
    Then the process rests at "build.quality.correctness.reviewing"
    And the commit subjects end with:
      """
      gtd(judge): implement.coverage → implement.prototype.testing
      gtd(agent): implement.prototype.testing → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      """
    And ".gtd/PROTOTYPE.md" does not exist

  Scenario: a failed criterion is fixed and re-tested before the quality lap
    Given step "implement.prototype.testing", when prompted with "Find how this project", writes ".gtd/PROTOTYPE.md" with:
      """
      # Prototype test

      ## AC-1: fail

      Ran `subtract(3, 1)` in a scratch directory; printed 4. Expected 2.

      ## AC-2: pass

      Ran `add(1, 1)`; printed 2.
      """
    And step "implement.prototype.fix.fixing" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "implement.prototype.fix.fixing" is prompted with "Read `.gtd/PROTOTYPE.md`: a hands-on test"
    And step "implement.prototype.health.check" changes nothing
    And step "implement.prototype.testing", when prompted with "This is a re-test", writes ".gtd/PROTOTYPE.md" with:
      """
      # Prototype test

      ## AC-1: pass

      Re-tested: `subtract(3, 1)` printed 2.

      ## AC-2: pass

      Re-ran `add(1, 1)`; printed 2.
      """
    When the process is driven
    Then the process rests at "build.quality.correctness.reviewing"
    And the commit subjects end with:
      """
      gtd(judge): implement.coverage → implement.prototype.testing
      gtd(agent): implement.prototype.testing → implement.prototype.fix.fixing
      gtd(agent): implement.prototype.fix.fixing → implement.prototype.health.check
      gtd(check): implement.prototype.health.check → implement.prototype.testing
      gtd(agent): implement.prototype.testing → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      """

  Scenario: a problem outside any criterion is fixed too
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.

      ## AC-2: pass

      Printed 2.

      ## Problem a warning on every call: fail

      Every call printed a deprecation warning.
      """
    When the process is driven
    Then the process rests at "implement.prototype.fix.fixing"

  Scenario: a blocked criterion goes to a person, not a fixer
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: blocked

      The criterion expects a - b, but the sketch asked for the absolute difference.

      ## AC-2: pass

      Printed 2.
      """
    When the process is driven
    Then the process rests at "implement.prototype.open"
    And the resting step's content contains "- AC-1: blocked"

  Scenario: overruling the open items goes on to the quality lap
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: blocked

      Could not tell.

      ## AC-2: pass

      Printed 2.
      """
    And step "implement.prototype.open" changes nothing
    When the process is driven
    Then the process rests at "build.quality.correctness.reviewing"
    And the commit subjects end with:
      """
      gtd(agent): implement.prototype.testing → implement.prototype.open
      gtd(human): implement.prototype.open → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      """

  Scenario: with no testing instructions the step rests at a gate saying so
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## No testing instructions

      No project skill, no manual testing section, no recognised project shape.
      """
    When the process is driven
    Then the process rests at "implement.prototype.unguided"
    And the resting step's content contains "no way to exercise this project for real"

  Scenario: a report missing a criterion is refused
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.
      """
    Then driving the process is refused with "exactly one chunk headed `## <ID>: pass|fail|blocked` for AC-2"

  Scenario: a testing turn that changes the working tree is refused
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.

      ## AC-2: pass

      Printed 2.
      """
    And step "implement.prototype.testing" writes "scratch.txt" with:
      """
      left behind
      """
    Then driving the process is refused with "change nothing but .gtd/PROTOTYPE.md"

  Scenario: a fix turn may not change the acceptance criteria
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: fail

      Printed 4.

      ## AC-2: pass

      Printed 2.
      """
    And step "implement.prototype.fix.fixing" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-2: add is unchanged.
      """
    Then driving the process is refused with "criteria-frozen"

  Scenario: a fix turn may not edit the report it fixes from
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: fail

      Printed 4.

      ## AC-2: pass

      Printed 2.
      """
    And step "implement.prototype.fix.fixing" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "implement.prototype.fix.fixing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Fixed.

      ## AC-2: pass

      Printed 2.
      """
    Then driving the process is refused with "prototype-fix: leave .gtd/PROTOTYPE.md as it is"

  Scenario: a chunk naming no criterion of the change is still an open item
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.

      ## AC-2: pass

      Printed 2.

      ## AC-9: fail

      No such command yet.
      """
    When the process is driven
    Then the process rests at "implement.prototype.fix.fixing"

  Scenario: instructions added at the unguided gate run the suite, then a fresh test
    Given step "implement.prototype.testing", when prompted with "Find how this project", writes ".gtd/PROTOTYPE.md" with:
      """
      ## No testing instructions

      Nothing found.
      """
    And step "implement.prototype.unguided" writes "AGENTS.md" with:
      """
      ## Manual testing

      Run `node -e` against the calculator in a scratch directory.
      """
    And step "implement.prototype.health.check" changes nothing
    And step "implement.prototype.testing" is prompted with "Find how this project"
    When the process is driven
    # The fresh test still finds no way in; the gate's second visit adds nothing new and goes on.
    Then the process rests at "build.quality.correctness.reviewing"
    And the commit subjects end with:
      """
      gtd(agent): implement.prototype.testing → implement.prototype.unguided
      gtd(human): implement.prototype.unguided → implement.prototype.health.check
      gtd(check): implement.prototype.health.check → implement.prototype.testing
      gtd(agent): implement.prototype.testing → implement.prototype.unguided
      gtd(human): implement.prototype.unguided → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      """

  Scenario: a clean land at the unguided gate goes on untested
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## No testing instructions

      Nothing found.
      """
    And step "implement.prototype.unguided" changes nothing
    When the process is driven
    Then the process rests at "build.quality.correctness.reviewing"
    And the commit subjects end with:
      """
      gtd(agent): implement.prototype.testing → implement.prototype.unguided
      gtd(human): implement.prototype.unguided → implement.closing
      gtd(check): implement.closing → build.quality.correctness.reviewing
      """

  Scenario: a no-instructions chunk beside tested criteria is read as an ordinary report
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: fail

      Printed 4.

      ## AC-2: pass

      Printed 2.

      ## No testing instructions

      Found none for the edge cases; used the CLI.
      """
    When the process is driven
    Then the process rests at "implement.prototype.fix.fixing"

  Scenario: a fix turn that finds nothing to fix goes on to the re-test
    Given step "implement.prototype.testing", when prompted with "Find how this project", writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: fail

      Printed 4, I think.

      ## AC-2: pass

      Printed 2.
      """
    And step "implement.prototype.fix.fixing" changes nothing
    And step "implement.prototype.health.check" changes nothing
    And step "implement.prototype.testing", when prompted with "This is a re-test", writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Looked again: printed 2.

      ## AC-2: pass

      Printed 2.
      """
    When the process is driven
    Then the process rests at "build.quality.correctness.reviewing"

  Scenario: a problem heading that misses the shape is refused, not dropped
    Given step "implement.prototype.testing" writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: pass

      Printed 2.

      ## AC-2: pass

      Printed 2.

      ## Problem every call warns — fail

      Each call printed a deprecation warning.
      """
    Then driving the process is refused with "these miss it:"

  Scenario: a re-test that finds no way to test is refused, keeping the open items in view
    Given step "implement.prototype.testing", when prompted with "Find how this project", writes ".gtd/PROTOTYPE.md" with:
      """
      ## AC-1: fail

      Printed 4.

      ## AC-2: pass

      Printed 2.
      """
    And step "implement.prototype.fix.fixing" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "implement.prototype.health.check" changes nothing
    And step "implement.prototype.testing", when prompted with "This is a re-test", writes ".gtd/PROTOTYPE.md" with:
      """
      ## No testing instructions

      The CLI is gone.
      """
    Then driving the process is refused with "needs exactly one chunk"
