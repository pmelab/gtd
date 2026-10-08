Feature: Review triage — one four-way verdict per note, and its route

  `build.review.triage` judges each note the human added to `.gtd/REVIEW.md`
  (a line note, a one-shot footnote, prose under a chunk) with one `choice`
  answer: `edit`, `question`, `nit` or `praise`. An `edit` goes to
  `build.review.collecting` and a planning lap; a `question` is answered inline
  at the same gate (`build.review.answer-review-questions`); a `nit` is fixed in
  one batch (`build.review.fix-nits`) and followed by a fresh review; `praise`
  is dropped. Only a confident non-`edit` verdict on uncut evidence skips the
  lap — a cut, unanswered or below-floor note counts as `edit`.

  Every scenario reaches `build.review.await-review` by the shortest real
  history — `--workflow review` with the quality lap disabled, then
  one reviewer turn writing `.gtd/REVIEW.md`. `closing`'s own shell body is
  a script a real driver runs, never this in-memory harness — its effect is
  given by hand here.

  @inmem
  Scenario: praise only signs off with no planner turn spent
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      export const mul = (a: number, b: number) => a * b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      add
      - [ ] ./src/calc.ts#2-2
      sub
      - [ ] ./src/calc.ts#3-3
      mul
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1-1
      add — looks good, nice work
      - [ ] ./src/calc.ts#2-2
      sub
      - [ ] ./src/calc.ts#3-3
      mul
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.triage"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "note-1", "answer": "praise", "p": 0.9}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → idle"
    And the git log does not contain "build.review.collecting"

  @inmem
  Scenario: an edit note hands its capture off to collecting
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      export const mul = (a: number, b: number) => a * b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      add
      - [ ] ./src/calc.ts#2-2
      sub
      - [ ] ./src/calc.ts#3-3
      mul
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1-1
      add — rename `add` to `sum`
      - [ ] ./src/calc.ts#2-2
      sub
      - [ ] ./src/calc.ts#3-3
      mul
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.triage"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "note-1", "answer": "edit", "p": 0.9}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.collecting"
    When I run gtd next
    Then it succeeds
    And stdout contains "downstream agent judges"
    And stdout contains "note-1"
    And stdout contains "rename `add` to `sum`"

  @inmem
  Scenario: a non-edit verdict below the reviewNoteActionable floor still counts as an edit
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      export const mul = (a: number, b: number) => a * b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      add
      - [ ] ./src/calc.ts#2-2
      sub
      - [ ] ./src/calc.ts#3-3
      mul
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1-1
      add — maybe reconsider the name?
      - [ ] ./src/calc.ts#2-2
      sub
      - [ ] ./src/calc.ts#3-3
      mul
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.triage"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "note-1", "answer": "praise", "p": 0.5}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.collecting"

  @inmem
  Scenario: a note the evidence budget cuts falls back to edit despite a confident praise
    Given an environment variable "GTD_JUDGEBUDGETBYTES" set to "10"
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      export const mul = (a: number, b: number) => a * b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      add
      - [ ] ./src/calc.ts#2-2
      sub
      - [ ] ./src/calc.ts#3-3
      mul
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1-1
      add — looks good, nice work
      - [ ] ./src/calc.ts#2-2
      sub
      - [ ] ./src/calc.ts#3-3
      mul
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.triage"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "note-1", "answer": "praise", "p": 0.99}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.collecting"

  @inmem
  Scenario: questions only are answered inline and the process rests at the review gate again
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      export const mul = (a: number, b: number) => a * b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      add
      - [ ] ./src/calc.ts#2-2
      sub
      - [ ] ./src/calc.ts#3-3
      mul
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1-1
      add — why not bigint?
      - [ ] ./src/calc.ts#2-2
      sub — and why not here?
      - [ ] ./src/calc.ts#3-3
      mul
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.triage"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "note-1", "answer": "question", "p": 0.9},
        {"id": "note-2", "answer": "question", "p": 0.9}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.answer-review-questions"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      add — why not bigint?
        A: numbers are enough here.
      - [ ] ./src/calc.ts#2-2
      sub — and why not here?
        A: same reason.
      - [ ] ./src/calc.ts#3-3
      mul
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.answer-review-questions → build.review.await-review"
    And ".gtd/REVIEW.md" exists
    And ".gtd/REQUIREMENTS.md" does not exist
    And the git log does not contain "build.review.collecting"

  @inmem
  Scenario: nits only are fixed in one batch, then a fresh review rests at the gate
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      export const mul = (a: number, b: number) => a * b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      add
      - [ ] ./src/calc.ts#2-2
      sub
      - [ ] ./src/calc.ts#3-3
      mul
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1-1
      add — typo in name
      - [ ] ./src/calc.ts#2-2
      sub — missing semicolon
      - [ ] ./src/calc.ts#3-3
      mul
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.triage"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "note-1", "answer": "nit", "p": 0.9},
        {"id": "note-2", "answer": "nit", "p": 0.9}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.fix-nits"
    Given "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b;
      export const sub = (a: number, b: number) => a - b;
      export const mul = (a: number, b: number) => a * b
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.fix-nits → build.health.check"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.reviewing"
    And the git log does not contain "build.review.collecting"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-3
      add, sub, mul — nits fixed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.reviewing → build.review.await-review"

  @inmem
  Scenario: questions and nits — the fresh review carries each answer over
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      export const mul = (a: number, b: number) => a * b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      add
      - [ ] ./src/calc.ts#2-2
      sub
      - [ ] ./src/calc.ts#3-3
      mul
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1-1
      add — why not bigint?
      - [ ] ./src/calc.ts#2-2
      sub — missing semicolon
      - [ ] ./src/calc.ts#3-3
      mul
      """
    When I run gtd land
    Then it succeeds
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "note-1", "answer": "question", "p": 0.9},
        {"id": "note-2", "answer": "nit", "p": 0.9}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.answer-review-questions"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      add — why not bigint?
        A: numbers are enough here.
      - [ ] ./src/calc.ts#2-2
      sub — missing semicolon
      - [ ] ./src/calc.ts#3-3
      mul
      """
    When I run gtd land
    Then it succeeds
    Given "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b;
      export const mul = (a: number, b: number) => a * b
      """
    When I run gtd land
    Then it succeeds
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "Carry-over"
    And stdout contains "git show"

  @inmem
  Scenario: edit, question and nit together — answer, fix, then collect the edit
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      export const mul = (a: number, b: number) => a * b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      add
      - [ ] ./src/calc.ts#2-2
      sub
      - [ ] ./src/calc.ts#3-3
      mul
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1-1
      add — rename `add` to `sum`
      - [ ] ./src/calc.ts#2-2
      sub — why not bigint?
      - [ ] ./src/calc.ts#3-3
      mul — typo in name
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.triage"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "note-1", "answer": "edit", "p": 0.9},
        {"id": "note-2", "answer": "question", "p": 0.9},
        {"id": "note-3", "answer": "nit", "p": 0.9}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.answer-review-questions"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      add — rename `add` to `sum`
      - [ ] ./src/calc.ts#2-2
      sub — why not bigint?
        A: numbers are enough here.
      - [ ] ./src/calc.ts#3-3
      mul — typo in name
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.answer-review-questions → build.review.fix-nits"
    Given "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      export const product = (a: number, b: number) => a * b
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.fix-nits → build.health.check"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.collecting"
    When I run gtd next
    Then it succeeds
    And stdout contains "note-1"
    And stdout contains "rename `add` to `sum`"
    And stdout contains "Answered questions"
