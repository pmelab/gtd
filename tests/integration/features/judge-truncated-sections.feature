Feature: A section the judge budget cuts fails open (package 02)

  Both section-splitting judged gates — `packages.item.spec.pre` and
  `build.review.triage` — hand the judge one evidence key per `## `
  section/chunk, and `judgeBudgetBytes` is split evenly across those keys.
  A section whose evidence the budget cut can never pass on evidence the
  judge never saw: the flow treats it as not cleared — kept in the
  reviewer's scope, or actionable — whatever the judge answered for it.
  Each scenario reaches its gate by the shortest real history.

  @inmem
  Scenario: packages.item.spec.pre — a section the budget cuts stays in the reviewer's scope despite a confident yes
    Given a test project
    And the workflow
    And an environment variable "GTD_JUDGEBUDGETBYTES" set to "320"
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget factory. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Alpha
      - [ ] add src/a.ts, exported as the default widget builder for the whole factory line, including safety checks, telemetry hooks, and full inline documentation of every branch

      ## Bravo
      - [ ] add src/b.ts, exported as the fallback widget builder used whenever the default builder cannot run, with its own safety checks and telemetry hooks

      ## Charlie
      ok
      """
    And gtd lands "gtd(check): architecture-promote → packages.item.building"
    And a file "src/widget.ts" with:
      """
      export const widget = 1
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    When I run gtd next
    Then it succeeds
    And stdout contains "some evidence above was truncated to fit the judge's payload budget"

    When I run gtd judge answer with stdin:
      """
      [
        {"id": "section-1", "answer": true, "p": 0.99},
        {"id": "section-2", "answer": true, "p": 0.99},
        {"id": "section-3", "answer": true, "p": 0.99}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): packages.item.spec.pre → packages.item.spec.review"
    When I run gtd next
    Then it succeeds
    And stdout contains "Confine"
    And stdout contains "  - Alpha"
    And stdout contains "  - Bravo"
    And stdout does not contain "Charlie"

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
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
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
