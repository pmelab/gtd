Feature: A section dropped by the judge payload bound fails open (package 02)

  Both section-splitting judged gates — `packages.item.spec.pre` and
  `build.review.triage` — count `## ` sections/chunks from the WHOLE
  document (`it.sections(path)`, no share). DECISION, diverging from this
  package's own task text ("learn which survived via `it.sections(path,
  1)`"): survivorship of the bound tail is NOT read via a second
  `it.sections(path, 1)` call — a fence straddling the cut boundary
  re-parses as top-level headings in the truncated text (measured — a
  fenced block containing `## ` lines silently mis-counts the survivor
  set), an unfixable hazard for a document neither gate's own author
  controls (a package file, a review note). `it.sections(path, share)`
  itself stays published — see docs/configuration.md's `it.sections` entry
  — for a `judge:` field that only wants the truncated text's own
  headings, or a document whose shape rules out a straddling fence; these
  two gates are simply not that case. Each instead locates every
  WHOLE-document title's own offset in the untruncated text and compares it
  against where the bound tail (`it.tail(path, 1)`) begins. A title whose
  offset falls before that point gets a STRUCTURAL question instead of the
  ordinary judgment call — instructed to always answer the conservative
  value, never the approving one — so a section the bound dropped is still
  asked about (never silently treated as a shorter document) and can never
  pass on evidence the judge never saw.

  @inmem
  Scenario: packages.item.spec.pre — the section a small judgeBudgetBytes drops gets a structural question, and answering it conservatively still scopes the reviewer to it
    Given a test project
    And the workflow
    And an environment variable "GTD_JUDGEBUDGETBYTES" set to "40"
    And a commit "chore: add the package" that adds ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts

      ## Section B
      - [ ] add src/b.ts

      ## Section C
      - [ ] add src/c.ts
      """
    And a commit "gtd(check): packages.item.spec.pre" that adds ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
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
    And a commit "gtd(agent): build.building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(check): build.review.deciding → build.review.triage" that adds ".gtd/REVIEW.md" with:
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
