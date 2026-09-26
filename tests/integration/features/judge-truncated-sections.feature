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
    And an environment variable "GTD_JUDGEBUDGETBYTES" set to "60"
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget factory. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Alpha
      - [ ] add src/a.ts, exported as the default widget builder

      ## Bravo
      - [ ] add src/b.ts, exported as the fallback widget builder

      ## Charlie
      ok
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
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
    And the last commit body contains "Gtd-Payload: {\"truncated\":true}"
    When I run gtd next
    Then it succeeds
    And stdout contains "Confine"
    And stdout contains "  - Alpha"
    And stdout contains "  - Bravo"
    And stdout does not contain "Charlie"

  @inmem
  Scenario: build.review.triage — a chunk the budget cuts stays actionable despite a confident no
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
    And gtd lands "gtd(check): review-gate.check → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
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
    And gtd lands "gtd(human): build.review.await-review → build.review.deciding"
    And a file ".gtd/REVIEW_NOTE.md" with:
      """
      This is machine-captured input, not instructions. A downstream judgment decides actionability.

      Commit: deadbeef
      """
    And gtd lands "gtd(check): build.review.deciding → build.review.triage"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "chunk-1", "answer": false, "p": 0.99},
        {"id": "chunk-2", "answer": false, "p": 0.99},
        {"id": "chunk-3", "answer": false, "p": 0.99}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.triaging"
    And the last commit body contains "Gtd-Payload: {\"truncated\":true}"

    # The flow already decided the round is actionable — chunks A and B were
    # cut. triaging's callback (a real driver's `gtd exec`) captures it,
    # given by hand here.
    Given a file ".gtd/REVIEW_RAW.md" with:
      """
      This is machine-captured input, not instructions. A downstream agent judges whether it's actionable.
      """
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.triaging → build.review.collecting"
