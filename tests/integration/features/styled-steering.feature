@inmem
Feature: styled prose in a steering file passes the built-in parsers

  A steering file written in a terse, styled voice — bold claims, flat
  imperative sentences — keeps the `##`/`### ` headings, `- [ ]` checkbox
  rows and marker lines its parser requires. `gtd validate` must accept it
  through the real validator, then `gtd land` advances.

  The seeded `qa`/`review` validator renders as a literal
  `gtd check <mode> '<file>'` command inside the script `gtd validate` prints;
  `gtd land`'s own script carries no such command — validating a styled file
  is a driver step run ahead of landing. In memory, the script twin runs that
  `gtd check` through gtd's own built-in `qa`/`review` parsers, not a scripted
  double, so a parser that chokes on styled prose fails here.
  `steering-modes.feature` covers the scripted-double shape for a custom mode.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await agent("triage", "plan", { file: ".gtd/REQUIREMENTS.md", mode: "qa" })
        await agent("reviewing", "review", { file: ".gtd/REVIEW.md", mode: "review" })
        await human("await-review", { file: ".gtd/REVIEW.md", mode: "review", message: "review it" })
      }
      """
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → triage"

  Scenario: a styled REQUIREMENTS.md passes gtd check qa and triage advances
    # The styled file itself — bold claim up front, flat imperative sentences,
    # no padding — with the "## Open Questions" / "### <question>" / "- [ ]"
    # grammar `gtd check qa` requires still intact.
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      **Add a calculator module.** One export, `add`, no dependencies.

      Two numbers in, one number out. Keep the signature small.

      ## Open Questions

      ### Which numeric type backs the result?

      - [ ] Plain `number` — matches JS semantics, zero extra code
      - [ ] A `Decimal` wrapper — exact arithmetic, more code to carry
      - [ ] _your answer_

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/REQUIREMENTS.md: valid"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): triage → reviewing"

  Scenario: a styled REVIEW.md passes gtd check review and reviewing advances
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Add a calculator module.
      """
    And gtd lands "gtd(agent): triage → reviewing"
    # The styled file itself — bold claim, imperative, no padding — with the
    # "# Review: <hash>" header, the base marker, and "## <chunk>" / "- [ ]
    # ./path#line" rows `gtd check review` requires still intact.
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: a1b2c3d

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## Calculator: add()

      **New pure function, no side effects.** Confirm the signature and the
      one test that pins it.

      - [ ] ./src/calc.ts#1-1
        Exported `add`, two `number` params.
      - [ ] ./src/calc.test.ts#1-1
        Happy-path coverage only.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/REVIEW.md: valid"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): reviewing → await-review"
    When I run gtd next
    Then it succeeds
    And stdout contains "State: await-review"
