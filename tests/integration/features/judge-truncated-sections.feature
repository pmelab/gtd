Feature: A section the judge budget cuts fails open

  The section-splitting judged gate `build.review.triage` hands the judge one
  evidence key per `## ` chunk, and `judgeBudgetBytes` is split evenly across
  those keys. A chunk whose evidence the budget cut can never pass on evidence
  the judge never saw: the flow treats it as actionable whatever the judge
  answered for it.
  The scenario reaches its gate by the shortest real history.

  @inmem
  Scenario: build.review.triage — a note the budget cuts stays an edit despite a confident praise
    Given a test project
    And the workflow
    And an environment variable "GTD_JUDGEBUDGETBYTES" set to "40"
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd enters "review-gate.check" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: 0000000000000000000000000000000000000000 -->

      ## Chunk A
      - [ ] ./a.ts#1

      ## Chunk B
      - [ ] ./b.ts#1

      ## Chunk C
      - [ ] ./c.ts#1
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: 0000000000000000000000000000000000000000 -->

      ## A
      - [ ] ./a.ts#1 please rename this to something clearer

      ## B
      - [ ] ./b.ts#1 ok

      ## C
      ok
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.triage"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "note-1", "answer": "praise", "p": 0.99},
        {"id": "note-2", "answer": "praise", "p": 0.99},
        {"id": "note-3", "answer": "praise", "p": 0.99}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.collecting"
