Feature: Prompts carry diff RANGES, never diff CONTENT

  A gtd prompt never inlines a rendered diff. Instead it names the commit its
  changes are based at (`it.reviewBase`/`it.retainedBase`/`it.startCommit`) and
  tells the agent to inspect the range itself with `git diff`. Coverage for
  the `build.review.reviewing` and `build.squashing` prompt sites lives with their own
  flows (`default-workflow.feature`'s incremental-review scenario, `entry.feature`'s
  first-review scenario, `squash.feature`); this file covers the two sites
  nothing else exercises: `packages.item.spec.review` (the per-package build's
  own review prompt) and `build.review.deciding`'s captured manifest — see
  `src/workflows/unified.yaml` and `src/PatternTemplates.ts`.

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
    And a file ".gtd/NEXT.md" with:
      """
      Package: add a db module.
      """
    And an empty commit "gtd(check): packages.picking → packages.item.building"
    And an empty commit "gtd(agent): packages.item.building → packages.item.health.check"
    And an empty commit "gtd(check): packages.item.health.check → packages.item.spec.review"
    When I run gtd next
    Then it succeeds
    And stdout contains the hash of "process-start"
    And stdout does not contain "diff --git"
    And stdout does not contain "## Diff under review"

  @live
  Scenario: build.review.deciding's captured manifest names a commit and a path, never inlines a diff
    Given a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(agent): build.health.check → build.review.reviewing" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1 — new add function
      """
    And a commit "gtd(human): build.review.await-review → build.review.deciding" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1 — new add function — also handle negatives
      """
    And I mark the current commit as "review-commit"
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.collecting"
    And ".gtd/REVIEW_RAW.md" contains the hash of "review-commit"
    And ".gtd/REVIEW_RAW.md" contains ".gtd/REVIEW.md"
    And ".gtd/REVIEW_RAW.md" does not contain "diff --git"
