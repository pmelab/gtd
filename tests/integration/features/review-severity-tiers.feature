Feature: Review severity tiers — every edit note re-plans, ordered and labelled by tier

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" wiring review as feature's own tail
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.review.composing"

  @inmem
  Scenario: one one-way door, one new concept and six style edits
    Given a file ".gtd/REVIEW.md" with 8 pointer notes on "src/calc.ts"
    And gtd lands "gtd(check): build.review.composing → build.review.await-review"
    And ".gtd/REVIEW.md" is modified so note 1 reads "introduce an Operation abstraction" and note 2 reads "rename the file format version field"
    And the other notes in ".gtd/REVIEW.md" read "use a single quote"
    When I run gtd land
    Then the last commit subject is "gtd(human): build.review.await-review → build.review.triage"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "note-1", "answer": "edit", "p": 0.9},
        {"id": "note-1.security", "answer": "no", "p": 0.9},
        {"id": "note-1.reversibility", "answer": "two-way", "p": 0.9},
        {"id": "note-1.blastRadius", "answer": "local", "p": 0.9},
        {"id": "note-1.newConcept", "answer": "yes", "p": 0.9},
        {"id": "note-2", "answer": "edit", "p": 0.9},
        {"id": "note-2.security", "answer": "no", "p": 0.9},
        {"id": "note-2.reversibility", "answer": "one-way", "p": 0.9},
        {"id": "note-2.blastRadius", "answer": "contract", "p": 0.9},
        {"id": "note-2.newConcept", "answer": "no", "p": 0.9},
        {"id": "note-3", "answer": "edit", "p": 0.9},
        {"id": "note-3.security", "answer": "no", "p": 0.9},
        {"id": "note-3.reversibility", "answer": "two-way", "p": 0.9},
        {"id": "note-3.blastRadius", "answer": "local", "p": 0.9},
        {"id": "note-3.newConcept", "answer": "no", "p": 0.9},
        {"id": "note-4", "answer": "edit", "p": 0.9},
        {"id": "note-4.security", "answer": "no", "p": 0.9},
        {"id": "note-4.reversibility", "answer": "two-way", "p": 0.9},
        {"id": "note-4.blastRadius", "answer": "local", "p": 0.9},
        {"id": "note-4.newConcept", "answer": "no", "p": 0.9},
        {"id": "note-5", "answer": "edit", "p": 0.9},
        {"id": "note-5.security", "answer": "no", "p": 0.9},
        {"id": "note-5.reversibility", "answer": "two-way", "p": 0.9},
        {"id": "note-5.blastRadius", "answer": "local", "p": 0.9},
        {"id": "note-5.newConcept", "answer": "no", "p": 0.9},
        {"id": "note-6", "answer": "edit", "p": 0.9},
        {"id": "note-6.security", "answer": "no", "p": 0.9},
        {"id": "note-6.reversibility", "answer": "two-way", "p": 0.9},
        {"id": "note-6.blastRadius", "answer": "local", "p": 0.9},
        {"id": "note-6.newConcept", "answer": "no", "p": 0.9},
        {"id": "note-7", "answer": "edit", "p": 0.9},
        {"id": "note-7.security", "answer": "no", "p": 0.9},
        {"id": "note-7.reversibility", "answer": "two-way", "p": 0.9},
        {"id": "note-7.blastRadius", "answer": "local", "p": 0.9},
        {"id": "note-7.newConcept", "answer": "no", "p": 0.9},
        {"id": "note-8", "answer": "edit", "p": 0.9},
        {"id": "note-8.security", "answer": "no", "p": 0.9},
        {"id": "note-8.reversibility", "answer": "two-way", "p": 0.9},
        {"id": "note-8.blastRadius", "answer": "local", "p": 0.9},
        {"id": "note-8.newConcept", "answer": "no", "p": 0.9}
      ]
      """
    Then the last commit subject is "gtd(judge): build.review.triage → build.review.closing"
    And ".gtd/TODO.md" does not exist
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then the last commit subject is "gtd(check): build.review.closing → build.review.collecting"
    When I run gtd next
    Then stdout lists "note-2" before "note-1"
    And stdout contains "critical: one-way door"
    And stdout contains "should: new concept"
    And stdout lists "note-1" before "note-3"
    And stdout contains "note-8 — "

  @inmem
  Scenario: a `!` note is critical and never reaches the judge
    Given a file ".gtd/REVIEW.md" with 1 pointer note on "src/calc.ts"
    And gtd lands "gtd(check): build.review.composing → build.review.await-review"
    And ".gtd/REVIEW.md" note 1 reads "! rename `add` to `sum`"
    When I run gtd land
    Then the last commit subject is "gtd(human): build.review.await-review → build.review.closing"
    And the log has no "build.review.triage" commit
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    And I run gtd next
    Then stdout contains "critical: forced by `!`"
    And stdout contains "rename `add` to `sum`"
    And stdout does not contain "! rename"

  @inmem
  Scenario: a blank reviewSeverityMinP makes every tiered note critical
    Given gtd started workflow "review" with "--var reviewBase=base --var reviewSeverityMinP="
    And a file ".gtd/REVIEW.md" with 1 pointer note on "src/calc.ts"
    And gtd lands "gtd(check): build.review.composing → build.review.await-review"
    And ".gtd/REVIEW.md" note 1 reads "tidy the helper"
    When I run gtd land
    And I run gtd judge answer with note-1 judged a confident could
    Then the last commit subject is "gtd(judge): build.review.triage → build.review.closing"

  @inmem
  Scenario: a nit that renames a published API is still fixed as a nit
    Given a file ".gtd/REVIEW.md" with 1 pointer note on "src/calc.ts"
    And gtd lands "gtd(check): build.review.composing → build.review.await-review"
    And ".gtd/REVIEW.md" note 1 reads "rename exported `add` to `sum`"
    When I run gtd land
    And I run gtd judge answer with stdin:
      """
      [
        {"id": "note-1", "answer": "nit", "p": 0.9},
        {"id": "note-1.reversibility", "answer": "one-way", "p": 0.9}
      ]
      """
    Then the last commit subject is "gtd(judge): build.review.triage → build.review.fix.nits.fixing"

  @inmem
  Scenario: a could note is re-planned like any other edit, never deferred
    Given a file ".gtd/REVIEW.md" with 1 pointer note on "src/calc.ts"
    And gtd lands "gtd(check): build.review.composing → build.review.await-review"
    And ".gtd/REVIEW.md" note 1 reads "use a single quote"
    When I run gtd land
    And I run gtd judge answer with note-1 judged a confident could
    Then the last commit subject is "gtd(judge): build.review.triage → build.review.closing"
    And ".gtd/TODO.md" does not exist
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    And I run gtd next
    Then stdout contains "(could)"
