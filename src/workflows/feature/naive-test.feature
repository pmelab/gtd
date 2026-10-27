@inmem
Feature: a person tries the naive pass by hand before anything builds on it

  `naiveTest` is a factory option of the shipped workflows, off by default. On,
  every green naive pass is applied to the working tree and the process rests
  at `seam.try`. A clean landing signs it off and the process goes on — to the
  seam judge when the requirements ask for a release flag, else straight to the
  implementation. Notes in
  `.gtd/NAIVE-TEST.md`, a code edit or a requirements edit send it back: the
  pass and the person's code edits leave the tree again, and the next naive
  pass gets the notes and the edits. Every lap ends at the gate again.

  Rule: with no release flag asked for

    Background:
      Given a gtd config with:
        """
        import { feature } from "@pmelab/gtd/workflows/feature"
        export { summary, steering, skills, access } from "@pmelab/gtd/workflows/feature"
        export default feature({ naiveTest: true })
        """
      And an environment variable "GTD_QUALITYREVIEWS" set to ""
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

        ## Impact

        - the calculator module

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
        export const subtract = (a: number, b: number) => a + b
        """
      And step "seam.check" changes nothing
      And step "seam.applying" runs its script
      And step "seam.restoring" runs its script

    Scenario: a green naive pass rests at seam.try, applied to the working tree
      When the process is driven
      Then the process rests at "seam.try"
      And the resting step's content contains "try it by hand"
      And the resting step's content contains "`.gtd/NAIVE-TEST.md`"
      And "src/calc.ts" contains "export const subtract"
      And the commit subjects end with:
        """
        gtd(agent): seam.naive → seam.check
        gtd(check): seam.check → seam.applying
        gtd(check): seam.applying → seam.try
        """

    Scenario: a clean landing signs the pass off, takes it out and lands it as the implementation
      When the process is driven
      Then the process rests at "seam.try"
      When gtd lands
      And step "implement.applying" runs its script
      And step "implement.health.check" changes nothing
      And step "implement.closing" runs its script
      And the process is driven
      Then the process rests at "build.review.reviewing"
      And "src/calc.ts" contains "export const subtract"
      And the commit subjects end with:
        """
        gtd(check): seam.applying → seam.try
        gtd(human): seam.try → seam.restoring
        gtd(check): seam.restoring → implement.applying
        gtd(check): implement.applying → implement.health.check
        gtd(check): implement.health.check → implement.closing
        gtd(check): implement.closing → build.review.reviewing
        """

    Scenario: notes and a code edit send the pass back, out of the tree, to a naive pass that reads both
      Given step "seam.naive", when prompted with "> subtract(5, 3) printed 8, not 2.", writes "notes-read.txt" with:
        """
        read
        """
      And step "seam.naive", when prompted with "-- . ':(exclude).gtd'", writes "edits-read.txt" with:
        """
        read
        """
      When the process is driven
      Then the process rests at "seam.try"
      Given a file ".gtd/NAIVE-TEST.md" with:
        """
        subtract(5, 3) printed 8, not 2.
        """
      And a file "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        export const subtract = (a: number, b: number) => a - b
        """
      And a file "src/hint.ts" with:
        """
        export const hint = "subtract, not add"
        """
      When gtd lands
      And the process is driven
      Then the process rests at "seam.try"
      And "src/hint.ts" does not exist
      And "notes-read.txt" contains "read"
      And "edits-read.txt" contains "read"
      And ".gtd/NAIVE-TEST.md" does not exist
      And the commit subjects end with:
        """
        gtd(check): seam.applying → seam.try
        gtd(human): seam.try → seam.restoring
        gtd(check): seam.restoring → seam.naive
        gtd(agent): seam.naive → seam.check
        gtd(check): seam.check → seam.applying
        gtd(check): seam.applying → seam.try
        """

    Scenario: notes alone send the pass back with no edits to read
      Given step "seam.naive", when prompted with "They edited the code", writes "edits-read.txt" with:
        """
        read
        """
      When the process is driven
      Then the process rests at "seam.try"
      Given a file ".gtd/NAIVE-TEST.md" with:
        """
        subtract adds.
        """
      When gtd lands
      And the process is driven
      Then the process rests at "seam.try"
      And "edits-read.txt" does not exist

    Scenario: a requirements edit at seam.try stays, and sends the pass back
      When the process is driven
      Then the process rests at "seam.try"
      Given a file ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Impact

        - the calculator module

        ## Acceptance Criteria

        - AC-1: subtract(a, b) returns a - b.
        - AC-2: subtract(a, b) rejects NaN.
        """
      When gtd lands
      And the process is driven
      Then the process rests at "seam.try"
      And ".gtd/REQUIREMENTS.md" contains "AC-2: subtract(a, b) rejects NaN."
      And the commit subjects end with:
        """
        gtd(human): seam.try → seam.restoring
        gtd(check): seam.restoring → seam.naive
        gtd(agent): seam.naive → seam.check
        gtd(check): seam.check → seam.applying
        gtd(check): seam.applying → seam.try
        """

  Rule: with a release flag asked for

    Background:
      Given a gtd config with:
        """
        import { feature } from "@pmelab/gtd/workflows/feature"
        export { summary, steering, skills, access } from "@pmelab/gtd/workflows/feature"
        export default feature({ naiveTest: true })
        """
      And an environment variable "GTD_QUALITYREVIEWS" set to ""
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

        ## Impact

        - the calculator module

        ## Release Flag

      new

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
        export const subtract = (a: number, b: number) => a + b
        """
      And step "seam.check" changes nothing
      And step "seam.applying" runs its script
      And step "seam.restoring" runs its script

    Scenario: the person tries the pass before the seam judge rules
      When the process is driven
      Then the process rests at "seam.try"
      And the resting step's content contains "the seam judge rules on its shape"
      When gtd lands
      And the process is driven
      Then the process rests at "seam.judge"

  Rule: with a naiveTest that is neither true nor false

    Background:
      Given an environment variable "GTD_NAIVETEST" set to "maybe"
      And a gtd config with:
        """
        import { feature } from "@pmelab/gtd/workflows/feature"
        export { summary, steering, skills, access } from "@pmelab/gtd/workflows/feature"
        export default feature()
        """
      And a file "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        """
      And the working tree is committed as "feat: add calculator"
      And a file "TODO.md" with:
        """
        # Add subtract
        """

    Scenario: the landing that would pin it is refused
      Then driving the process is refused with "naiveTest must be"
