@inmem
Feature: a feature process ends at the human review

  After the quality lap the process rests at the review gate,
  `.gtd/REVIEW.md`. A sign-off ends the process. A note asking for a change in
  behaviour starts a feedback lap — design, then implement with no new naive
  pass or seam judge, the hands-on test, the quality lap — and the review
  again. Its design keeps a built criterion's ID and numbers
  new behaviour above every ID handed out.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_PROTOTYPEROUNDS" set to "0"
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

      ## Concerns

      ### Subtract

      - `subtract(a, b)` returns `a - b`.

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: subtract(a, b) returns a - b.
      """
    And step "design.gate.answer" changes nothing
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
    And step "implement.applying" runs its script
    And step "implement.health.check" changes nothing
    And step "implement.closing" runs its script
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#2-2
        new subtract function
      """
    And step "build.review.closing" runs its script
    And step "build.review.carrying" runs its script
    And judge step "build.review.ranking" answers:
      """
      []
      """

  Scenario: a feature process ends at the review gate
    When the process is driven
    Then the process rests at "build.review.await-review"
    And ".gtd/REQUIREMENTS.md" does not exist
    And the resting step's content contains the hash of the commit "feat: add calculator"
    And the commit subjects end with:
      """
      gtd(check): implement.health.check → implement.closing
      gtd(check): implement.closing → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.ranking
      gtd(judge): build.review.ranking → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      """

  Scenario: a sign-off ends the process at idle
    When the process is driven
    Then the process rests at "build.review.await-review"
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## Walkthrough

      ### calc

      - [x] ./src/calc.ts#2-2
        new subtract function
      """
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/REVIEW.md" does not exist
    And the commit subjects end with:
      """
      gtd(agent): build.review.reviewing → build.review.ranking
      gtd(judge): build.review.ranking → build.review.carrying
      gtd(check): build.review.carrying → build.review.await-review
      gtd(human): build.review.await-review → build.review.closing
      gtd(check): build.review.closing → idle
      """

  Rule: a note asking for new behaviour runs the feedback lap

    Background:
      Given step "build.review.collecting" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Concerns

        ### Multiply

        - Export `multiply()`.
        """
      And step "build.review.collecting" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#2-2
          new subtract function[^why]

        [^why]:
            - H: also export multiply
            - A: noted in the requirements.
        """
      And step "re-unwind" runs its script
      When the process is driven
      Then the process rests at "build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## Walkthrough

        ### calc

        - [ ] ./src/calc.ts#2-2
          new subtract function[^why]

        [^why]:
            - H: also export multiply
        """
      When gtd lands
      And the process is driven
      Then the process rests at "build.review.await-review"
      And ".gtd/REQUIREMENTS.md" contains "multiply"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## Walkthrough

        ### calc

        - [ ] ./src/calc.ts#2-2
          new subtract function
        """

    Scenario: the lap keeps AC-1, adds AC-2, and builds both before the next review
      Given step "design.triage" from now on changes nothing
      And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Concerns

        ### Multiply

        - `multiply(a, b)` returns `a * b`.

        ## Impact

        - the greeting module

        ## Acceptance Criteria

        - AC-1: subtract(a, b) returns a - b.
        - AC-2: multiply(a, b) returns a * b.
        """
      And step "implement.building" writes "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        export const subtract = (a: number, b: number) => a - b
        export const multiply = (a: number, b: number) => a * b
        """
      And step "implement.building" writes "src/multiply.test.ts" with:
        """
        it("[AC-2] multiplies", () => {})
        """
      When gtd lands
      And the process is driven
      Then the process rests at "build.review.await-review"
      And ".gtd/REQUIREMENTS.md" does not exist
      And the commit subjects end with:
        """
        gtd(human): build.review.await-review → build.review.closing
        gtd(check): build.review.closing → re-unwind
        gtd(check): re-unwind → design.triage
        gtd(agent): design.triage → design.gate.answer
        gtd(human): design.gate.answer → implement.building
        gtd(agent): implement.building → implement.health.check
        gtd(check): implement.health.check → implement.closing
        gtd(check): implement.closing → build.review.reviewing
        gtd(agent): build.review.reviewing → build.review.ranking
        gtd(judge): build.review.ranking → build.review.carrying
        gtd(check): build.review.carrying → build.review.await-review
        """

    Scenario: a design numbering new behaviour at or below an earlier ID is refused
      Given step "design.triage" from now on changes nothing
      And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Concerns

        ### Multiply

        - `multiply(a, b)` returns `a * b`.

        ## Impact

        - the greeting module

        ## Acceptance Criteria

        - AC-0: multiply(a, b) returns a * b.
        - AC-1: subtract(a, b) returns a - b.
        """
      When gtd lands
      Then driving the process is refused with "criteria-ids"
