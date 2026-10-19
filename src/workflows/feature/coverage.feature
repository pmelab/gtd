@inmem
Feature: a feature is done only when every acceptance criterion has a passing test

  Once the implementation's suite is green, implement.coverage asks a judge,
  per criterion ID of .gtd/REQUIREMENTS.md, whether a test the change added or
  changed covers it. Every ID covered lets the process close out, the judge's
  landing marking each as `Gtd-Mark: covers=<id>`. An uncovered ID sends the
  process back to a covering turn instead; after two, it rests for a person.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
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
      export const subtract = (a: number, b: number) => a - b
      """
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => expect(subtract(3, 1)).toBe(2))
      // AC-2: add is untouched
      """
    And step "seam.check" changes nothing
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script

  Scenario: the judge asks per criterion over the change's test files
    When the process is driven
    Then the process rests at "implement.coverage"
    And the output of gtd "judge" contains "add is unchanged."
    And the output of gtd "judge" contains "[AC-1] subtracts"

  Scenario: every ID covered ends the feature and marks the IDs it covers
    Given judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"yes","p":0.9}]
      """
    When the process is driven
    Then the process rests at "idle"
    And the commit subjects end with:
      """
      gtd(check): implement.applying → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.closing
      gtd(check): implement.closing → idle
      """
    And the commit "gtd(judge): implement.coverage → implement.closing" has a body containing "Gtd-Mark: covers=AC-1"
    And the commit "gtd(judge): implement.coverage → implement.closing" has a body containing "Gtd-Mark: covers=AC-2"
    And no commit body contains "Gtd-Mark: uncovered="

  Scenario: one uncovered ID sends the process back instead of ending it
    Given judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"no","p":0.9}]
      """
    When the process is driven
    Then the process rests at "implement.covering"
    And the last commit subject is "gtd(judge): implement.coverage → implement.covering"
    And the resting step's content contains "no passing test in this change that covers AC-2."
    And no commit body contains "Gtd-Mark: covers="

  Scenario: a yes below the confidence floor does not cover
    Given judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"yes","p":0.5}]
      """
    When the process is driven
    Then the process rests at "implement.covering"
    And the resting step's content contains "covers AC-2."

  Scenario: a covering turn runs the suite before the judge rules again
    Given judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"no","p":0.9}]
      """
    And step "implement.covering" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => expect(subtract(3, 1)).toBe(2))
      it("[AC-2] adds", () => expect(add(1, 1)).toBe(2))
      """
    When the process is driven
    Then the process rests at "implement.uncovered"
    And the commit subjects end with:
      """
      gtd(judge): implement.coverage → implement.covering
      gtd(agent): implement.covering → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.covering
      gtd(agent): implement.covering → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.uncovered
      """
    And the resting step's content contains "still finds no passing test for AC-2"

  Scenario: a covering turn may not change the acceptance criteria
    Given judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"no","p":0.9}]
      """
    And step "implement.covering" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      """
    Then driving the process is refused with "criteria-frozen"

  Scenario: overruling at the gate ends the feature, recording the uncovered IDs
    Given judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"no","p":0.9}]
      """
    And step "implement.covering" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => expect(subtract(3, 1)).toBe(2))
      it("[AC-2] adds", () => expect(add(1, 1)).toBe(2))
      """
    And step "implement.uncovered" changes nothing
    When the process is driven
    Then the process rests at "idle"
    And the commit "gtd(human): implement.uncovered → implement.closing" has a body containing "Gtd-Mark: covers=AC-1"
    And the commit "gtd(human): implement.uncovered → implement.closing" has a body containing "Gtd-Mark: uncovered=AC-2"

  Scenario: an empty covering turn asks the judge again rather than stalling
    Given judge step "implement.coverage" answers:
      """
      [{"id":"AC-1","answer":"yes","p":0.9},{"id":"AC-2","answer":"no","p":0.9}]
      """
    And step "implement.covering" changes nothing
    When the process is driven
    Then the process rests at "implement.uncovered"
    And the commit subjects end with:
      """
      gtd(agent): implement.covering → implement.health.check
      gtd(check): implement.health.check → implement.coverage
      gtd(judge): implement.coverage → implement.uncovered
      """
