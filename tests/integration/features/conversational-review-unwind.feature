Feature: Review conversation re-unwind — edits from every round are reverted

  A hand-edit made in an earlier reply round is restored by the re-unwind to
  its content when the review was written, not just the last round's edits.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { start } from "@pmelab/gtd/flows"
      import { afterTail, baseline, buildTail, gate } from "@pmelab/gtd/workflows"

      export {
        feature as default,
        feature,
        defaults,
        envDefaults,
        summary,
        base,
        steering,
        skills,
        access,
      } from "@pmelab/gtd/workflows"

      // review and fix as feature's own tail: a note is triaged and re-planned.
      export async function review() {
        await gate("review-gate", "The baseline is red.")
        return afterTail(await buildTail(start()))
      }

      export async function fix() {
        if (await baseline("fix-precheck")) return
        return afterTail(await buildTail(start(), { fixFirst: true }))
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
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"

  @inmem
  Scenario: a hand-edit from an earlier reply round is reverted by the re-unwind, back to its reviewed content
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
      """
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // TODO: also export multiply
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Multiply

      Export `multiply()`.
      """
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
          - A: this is the addition helper.
      """
    And gtd lands "gtd(agent): build.review.collecting → build.review.await-review"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → re-unwind"
    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → design.triage"
    And "src/calc.ts" does not contain "TODO"
