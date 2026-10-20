Feature: Prompts carry diff RANGES, never diff CONTENT

  A gtd prompt never inlines a rendered diff. Instead it names the commit its
  changes are based at (the step's review base, or the process's `start()`) and
  tells the agent to inspect the range itself with `git diff`. Coverage for
  the `build.review.reviewing` prompt site lives with its own flows
  (`default-workflow.feature`'s incremental-review scenario, `entry.feature`'s
  first-review scenario); `gtd summary`'s own prompt follows the same rule and
  is covered by `summary.feature`. This file covers the one site nothing else
  exercises: the review capture `build.review.collecting` is handed.

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

  @inmem
  Scenario: build.review.collecting's captured manifest names a commit and a path, never inlines a diff
    Given an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.review.composing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      new add function
      """
    And gtd lands "gtd(check): build.review.composing → build.review.await-review"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1-1
      new add function — also handle negatives
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.triage"
    And I mark the current commit as "review-commit"
    When I run gtd judge answer with stdin:
      """
      [{"id": "note-1", "answer": "edit", "p": 0.95}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.closing"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.collecting"
    When I run gtd next
    Then it succeeds
    And stdout contains the hash of "review-commit"
    And stdout contains ".gtd/REVIEW.md"
    And stdout does not contain "diff --git"
