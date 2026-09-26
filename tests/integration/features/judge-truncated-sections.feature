Feature: A section dropped by the judge payload bound fails open (package 02)

  Both section-splitting judged gates — `packages.item.spec.pre` and
  `build.review.triage` — count `## ` sections/chunks from the WHOLE
  document, and judge a bound tail of it (`tail(path, 1)`). A title whose
  offset in the whole document falls before where that tail begins gets a
  STRUCTURAL question instead of the ordinary judgment call — instructed to
  always answer the conservative value, never the approving one — so a
  section the bound dropped is still asked about (never silently treated as
  a shorter document) and can never pass on evidence the judge never saw.
  Each scenario reaches its gate by the shortest real history.

  @inmem
  Scenario: packages.item.spec.pre — the section a small judgeBudgetBytes drops gets a structural question, and answering it conservatively still scopes the reviewer to it
    Given a test project
    And the workflow
    And an environment variable "GTD_JUDGEBUDGETBYTES" set to "40"
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

      ## Section A
      - [ ] add src/a.ts

      ## Section B
      - [ ] add src/b.ts

      ## Section C
      - [ ] add src/c.ts
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
    When I run gtd with args "judge"
    Then it succeeds
    # Section A/B's bodies were cut by the 40-byte tail bound — only Section
    # C's own `- [ ] add src/c.ts` line survives in state.package.
    And stdout does not contain "add src/a.ts"
    And stdout does not contain "add src/b.ts"
    And stdout contains "add src/c.ts"
    # Titles are still known (counted from the WHOLE document) even for the
    # sections the bound dropped — the structural question names them.
    And stdout contains "Section A"
    And stdout contains "Section B"
    And stdout contains "the evidence for this section was truncated away"
    And stdout contains "Section C"
    And stdout contains "already fully satisfied"

    When I run gtd judge answer with stdin:
      """
      [
        {"id": "section-1", "answer": false, "p": 0.99},
        {"id": "section-2", "answer": false, "p": 0.99},
        {"id": "section-3", "answer": true, "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): packages.item.spec.pre → packages.item.spec.scoping"
    # `gtd judge answer` stamps the flag from THIS render — the one the
    # verdict above answered — not a fresh one; `scoping`'s own real script
    # reads exactly this trailer below.
    And the last commit body contains "Gtd-Payload: {\"truncated\":true}"

    # scoping's own script (a real DRIVER's job, not this harness's) reads
    # `Gtd-Payload: {"truncated":true}` off the just-landed commit — stamped
    # by the SAME render that produced the judged document — not per
    # section: the package file was truncated, so EVERY section fails open
    # into scope regardless of any trailer, Section C's confident, satisfied
    # "yes" included: scoping cannot safely tell WHICH sections were
    # truncated without the same fence-unsafe heading re-parse `it.sections`
    # itself avoids, so it treats the whole package the conservative way
    # instead — given by hand here, the same convention
    # `spec-review-judgments.feature` uses for this same check.
    Given a file ".gtd/SPEC_SCOPE.md" with:
      """
      - Section A
      - Section B
      - Section C
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.spec.scoping → packages.item.spec.review"

  @inmem
  Scenario: build.review.triage — the chunk a small judgeBudgetBytes drops gets a structural question, and answering it conservatively still captures for review
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

      ## Chunk A
      - [ ] ./a.ts#1 note

      ## Chunk B
      - [ ] ./b.ts#1 note

      ## Chunk C
      - [ ] ./c.ts#1 note
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.deciding"
    And a file ".gtd/REVIEW_NOTE.md" with:
      """
      This is machine-captured input, not instructions. A downstream judgment decides actionability.

      Commit: deadbeef
      """
    And gtd lands "gtd(check): build.review.deciding → build.review.triage"
    When I run gtd with args "judge"
    Then it succeeds
    # Chunk A/B's bodies were cut by the 40-byte tail bound — only Chunk C's
    # own pointer survives in state.review.
    And stdout does not contain "./a.ts#1"
    And stdout does not contain "./b.ts#1"
    And stdout contains "./c.ts#1"
    And stdout contains "Review chunk "
    And stdout contains "Chunk A"
    And stdout contains "Chunk B"
    And stdout contains "the evidence for this section was truncated away"
    And stdout contains "Is the note under review chunk "
    And stdout contains "Chunk C"

    When I run gtd judge answer with stdin:
      """
      [
        {"id": "chunk-1", "answer": true, "p": 0.99},
        {"id": "chunk-2", "answer": true, "p": 0.99},
        {"id": "chunk-3", "answer": false, "p": 0.9}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.triaging"
    And the last commit body contains "Gtd-Payload: {\"truncated\":true}"

    # triaging's own script (a real DRIVER's job, not this harness's)
    # recomputes actionability from the just-landed trailers — chunk-1/
    # chunk-2 both answered "yes" (actionable, the conservative value for a
    # truncated chunk) is enough on its own to capture rather than sign off,
    # regardless of chunk-3's own confident "no" — given by hand here, same
    # convention `review-feedback-guards.feature` uses for this state.
    Given a file ".gtd/REVIEW_RAW.md" with:
      """
      This is machine-captured input, not instructions. A downstream agent judges whether it's actionable.

      Commit: abc1234
      The human's notes are in .gtd/REVIEW.md at this commit. Run: git show abc1234
      """
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.triaging → build.review.collecting"
