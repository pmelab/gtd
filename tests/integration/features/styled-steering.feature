@inmem
Feature: the voice survives the parsers it shares a prompt with (package 03, task 3)

  Package 03 injects gtd's own terse "voice" alongside a structural-override
  format contract into every machine-parsed prompt state, so an agent styling its prose can't also style
  away the `##`/`### ` headings, `- [ ]` checkbox rows, or marker lines the
  parser requires. This feature is the end-to-end proof: a HUMAN, standing in
  for the agent, writes a styled `.gtd/REQUIREMENTS.md`/`.gtd/REVIEW.md` at
  one of those resting states — voice in the prose, grammar intact — and
  `gtd validate` must actually accept it through the real validator, then
  `gtd land` advances — not just look plausible.

  The seeded `qa`/`review` validator renders as a literal
  `gtd check <mode> '<file>'` command inside the script `gtd validate` prints;
  `gtd land`'s own script carries no such command — validating a styled file
  is a driver step run ahead of landing. In memory, the script twin runs that
  `gtd check` through gtd's own built-in `qa`/`review` parsers, not a scripted
  double, so a parser that chokes on styled prose fails here.
  `steering-modes.feature` covers the scripted-double shape for a custom mode.

  Scenario: a styled REQUIREMENTS.md passes gtd check qa and design.triage advances
    Given a test project
    And the workflow gtd install scaffolds
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → unwind"

    And the file "NOTE.md" is deleted

    And gtd lands "gtd(check): unwind → start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    # The styled file itself — bold claim up front, flat imperative sentences,
    # no padding — with the "## Open Questions" / "### <question>" / "- [ ]"
    # grammar `gtd check qa` requires still intact.
    And a file ".gtd/REQUIREMENTS.md" with:
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
    And the last commit subject is "gtd(agent): design.triage → design.gate.answer"

  Scenario: a styled REVIEW.md passes gtd check review and build.review.reviewing advances
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { start } from "@pmelab/gtd/flows"
      import { gate, handOffTail } from "@pmelab/gtd/workflows"

      export {
        feature as default,
        feature,
        fix,
        defaults,
        envDefaults,
        summary,
        base,
        steering,
        skills,
        access,
      } from "@pmelab/gtd/workflows"

      // review as fix's own tail: a reviewer turn, and a note handed to fix.
      export async function review() {
        await gate("review-gate", "The baseline is red.")
        await handOffTail(false, start())
      }
      """
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.review.reviewing"
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
    And the last commit subject is "gtd(agent): build.review.reviewing → build.review.await-review"
    When I run gtd next
    Then it succeeds
    And stdout contains "State: build.review.await-review"
