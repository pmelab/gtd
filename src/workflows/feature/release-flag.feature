@inmem
Feature: a release flag only when the requirements ask for one

  A change ships unflagged unless `.gtd/REQUIREMENTS.md` carries a
  `## Release Flag` section — written by triage, or by the skip path's impact
  turn, only when the sketch asks for a flag, and editable at the design gate.
  Its first line is `new` (a new release flag) or `existing: <NAME>` (behind a
  flag that already exists). Without it no seam judge or refactor runs and the
  naive pass lands as the implementation; with it the seam judge rules on the
  pass.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_RISK_TIER" set to "0"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      it("[AC-1] subtracts", () => {})
      """
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And step "seam.check" changes nothing

  Rule: the design path

    Background:
      Given a file "TODO.md" with:
        """
        # Add subtract

        subtract(a, b) returns the difference.
        """
      And step "design.gate.answer" changes nothing

    Scenario: with no Release Flag section the naive pass lands unjudged, and no flag is asked for
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Impact

        - the calculator module

        ## Acceptance Criteria

        - AC-1: subtract(a, b) returns a - b.
        """
      And step "implement.applying" runs its script
      And step "implement.health.check" changes nothing
      And step "implement.closing" runs its script
      When the process is driven
      Then the process rests at "build.review.reviewing"
      And "src/calc.ts" contains "subtract"
      And no commit body contains "seam.judge"
      And the commit subjects end with:
        """
        gtd(human): design.gate.answer → seam.naive
        gtd(agent): seam.naive → seam.check
        gtd(check): seam.check → implement.applying
        gtd(check): implement.applying → implement.health.check
        gtd(check): implement.health.check → implement.closing
        gtd(check): implement.closing → build.review.reviewing
        """

    Scenario: a new release flag asked for sends the naive pass to the seam judge
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Impact

        - the calculator module

        ## Release Flag

        new

        ## Acceptance Criteria

        - AC-1: subtract(a, b) returns a - b.
        """
      When the process is driven
      Then the process rests at "seam.judge"

    Scenario: an existing flag asked for sends the naive pass to the seam judge too
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Impact

        - the calculator module

        ## Release Flag

        existing: GTD_FLAG_BETA

        ## Acceptance Criteria

        - AC-1: subtract(a, b) returns a - b.
        """
      When the process is driven
      Then the process rests at "seam.judge"

    Scenario: a Release Flag section that asks for neither is refused
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Impact

        - the calculator module

        ## Release Flag

        maybe later

        ## Acceptance Criteria

        - AC-1: subtract(a, b) returns a - b.
        """
      Then driving the process is refused with "release-flag"

  Rule: the skip path

    Background:
      Given a file "TODO.md" with:
        """
        # Add subtract

        Ship it behind the existing GTD_FLAG_BETA flag.

        ## Acceptance criteria

        - subtract(a, b) returns a - b.
        """
      And judge step "design.clear" answers:
        """
        [{"id":"clear","answer":"yes","p":0.9}]
        """
      And step "design.normalise" runs its script

    Scenario: the impact turn records the flag the sketch asks for, and the seam judge rules
      Given step "design.impact" appends to ".gtd/REQUIREMENTS.md":
        """

        ## Impact

        - the calculator module

        ## Release Flag

        existing: GTD_FLAG_BETA
        """
      When the process is driven
      Then the process rests at "seam.judge"
      And ".gtd/REQUIREMENTS.md" contains "existing: GTD_FLAG_BETA"
