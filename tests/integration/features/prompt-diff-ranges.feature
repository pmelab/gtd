Feature: Prompts carry diff RANGES, never diff CONTENT

  A gtd prompt never inlines a rendered diff. Instead it names the commit its
  changes are based at (`refs.reviewBase`/`refs.processBase`/`refs.start`) and
  tells the agent to inspect the range itself with `git diff`. Coverage for
  the `build.review.reviewing` prompt site lives with its own flows
  (`default-workflow.feature`'s incremental-review scenario, `entry.feature`'s
  first-review scenario); `gtd summary`'s own prompt follows the same rule and
  is covered by `summary.feature`. This file covers the two sites nothing else
  exercises: `packages.item.spec.review` (the per-package build's own review
  prompt) and `build.review.deciding`'s captured manifest — see
  `src/workflows/unified.ts`.

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
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Add a db module. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-db.md" with:
      """
      Package: add a db module.
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-db.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    And a file "src/db-impl.ts" with:
      """
      export const dbImpl = {}
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    And gtd lands "gtd(judge): packages.item.spec.pre → packages.item.spec.scoping"
    And gtd lands "gtd(check): packages.item.spec.scoping → packages.item.spec.review"
    When I run gtd next
    Then it succeeds
    And stdout contains the hash of "process-start"
    And stdout does not contain "diff --git"
    And stdout does not contain "## Diff under review"

  @live
  Scenario: build.review.deciding's captured manifest names a commit and a path, never inlines a diff
    Given an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function — also handle negatives
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.deciding"
    And I mark the current commit as "review-commit"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.triage"
    And ".gtd/REVIEW_NOTE.md" contains the hash of "review-commit"
    And ".gtd/REVIEW_NOTE.md" contains ".gtd/REVIEW.md"
    And ".gtd/REVIEW_NOTE.md" does not contain "diff --git"
