Feature: Prompts carry diff RANGES, never diff CONTENT

  A gtd prompt never inlines a rendered diff. Instead it names the commit its
  changes are based at (the step's review base, or the process's `start()`) and
  tells the agent to inspect the range itself with `git diff`. Coverage for
  the `build.review.reviewing` prompt site lives with its own flows
  (`default-workflow.feature`'s incremental-review scenario, `entry.feature`'s
  first-review scenario); `gtd summary`'s own prompt follows the same rule and
  is covered by `summary.feature`. This file covers the two sites nothing else
  exercises: `packages.item.spec.review` (the per-package build's own review
  prompt) and the review capture `build.review.collecting` is handed.

  Background:
    Given a test project
    And the workflow

  @inmem
  Scenario: packages.item.spec.review prints the process base hash, never a rendered diff
    Given a commit "feat: add architecture" that adds "src/db.ts" with:
      """
      export const db = {}
      """
    And I mark the current commit as "process-start"
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → unwind"

    And the file "NOTE.md" is deleted

    And gtd lands "gtd(check): unwind → start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Add a db module. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-db.md" with:
      """
      Package: add a db module.
      """
    And gtd lands "gtd(check): architecture-promote → packages.item.building"
    And a file "src/db-impl.ts" with:
      """
      export const dbImpl = {}
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    And gtd lands "gtd(judge): packages.item.spec.pre → packages.item.spec.review"
    When I run gtd next
    Then it succeeds
    And stdout contains the hash of "process-start"
    And stdout does not contain "diff --git"
    And stdout does not contain "## Diff under review"

  @live
  Scenario: build.review.collecting's captured manifest names a commit and a path, never inlines a diff
    Given an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
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
