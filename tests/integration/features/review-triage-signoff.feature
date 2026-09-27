Feature: Review triage — sign-off with no planner turn spent, and the actionable capture

  A note-only round at `build.review.await-review` (the human edited
  `.gtd/REVIEW.md` itself, nothing hand-edited outside `.gtd/`) routes through
  `build.review.closing` to `build.review.triage` — one `noul` per `## `
  chunk, "actionable, not approval or nit?". Every chunk answered "no" at
  `reviewNoteActionable` confidence or more signs off straight to `idle`, spending no
  `build.review.collecting` planner turn at all; any chunk answered
  actionable instead hands the round's capture to `collecting`.

  Every scenario reaches `build.review.await-review` by the shortest real
  history — `--entry review-gate.check` with the quality lap disabled, then
  one reviewer turn writing `.gtd/REVIEW.md`. `closing`'s own shell body is
  a script a real driver runs, never this in-memory harness — its effect is
  given by hand here.

  @inmem
  Scenario: a purely approving remark signs off with no planner turn spent
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function — looks good, nice work
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.closing"

    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.triage"

    When I run gtd judge answer with stdin:
      """
      [{"id": "chunk-1", "answer": false, "p": 0.9}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → idle"
    And the git log does not contain "build.review.collecting"

  @inmem
  Scenario: a single actionable note hands its capture off to collecting
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function — rename `add` to `sum`
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.closing"

    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.triage"

    When I run gtd judge answer with stdin:
      """
      [{"id": "chunk-1", "answer": true, "p": 0.9}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.collecting"
    When I run gtd next
    Then it succeeds
    And stdout contains "downstream agent judges whether it's actionable"

  @inmem
  Scenario: a "no" below the reviewNoteActionable floor is not enough to dismiss the note
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function — maybe reconsider the name?
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.closing"

    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.triage"

    When I run gtd judge answer with stdin:
      """
      [{"id": "chunk-1", "answer": false, "p": 0.5}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.collecting"
