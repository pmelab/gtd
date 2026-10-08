@inmem
Feature: Review conversation — a question gets an answer at the same gate, not a lap

  A `- H:` thread in `.gtd/REVIEW.md` is answered by the agent inside the
  same file, and the process rests at the review gate again: no revert, no
  triage, no `.gtd/REQUIREMENTS.md`. A thread whose last entry is the agent's
  is open, and every landing at the gate is refused until the human replies
  with a conclusion or deletes it.

  Background:
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"

  Scenario: a reply-only round rests at the review gate again, with no requirements written
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.collecting"
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
          - A: this is the addition helper.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → build.review.await-review"
    And ".gtd/REQUIREMENTS.md" does not exist
    And ".gtd/REVIEW.md" exists

  Scenario: a signed-off review is refused while a thread is open
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
          - A: this is the addition helper.
      """
    And gtd lands "gtd(agent): build.review.collecting → build.review.await-review"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [x] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
          - A: this is the addition helper.
      """
    When I run gtd land
    Then it fails
    And stderr contains "open-threads"
    And stderr contains ".gtd/REVIEW.md:"
    And stderr contains "[^why]"

  Scenario: a mixed round folds a note into requirements and replies in the review, holding the lap
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      Please add a subtract function.

      [^why]:
          - H: why not multiply?
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Subtract

      Add a `subtract()` export. TECHNICAL.
      """
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
          - A: this is the addition helper.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → build.review.await-review"
    And ".gtd/REQUIREMENTS.md" exists
    And ".gtd/REVIEW.md" exists

  Scenario: a line note left after a reply round is not dropped as a sign-off
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
          - A: this is the addition helper.
      """
    And gtd lands "gtd(agent): build.review.collecting → build.review.await-review"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function

      Please add a subtract function.
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.collecting"

  Scenario: folds from an in-loop collect survive a judged-approving last round
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^a][^b]

      [^a]:
          - H: add subtract too.

      [^b]:
          - H: why not multiply?
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Subtract

      Export `subtract()`.
      """
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^b]

      [^b]:
          - H: why not multiply?
          - A: this is the addition helper.
      """
    And gtd lands "gtd(agent): build.review.collecting → build.review.await-review"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function — looks good
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.triage"
    When I run gtd judge answer with stdin:
      """
      [{"id": "note-1", "answer": "praise", "p": 0.99}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.closing"
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → re-unwind"
    And ".gtd/REQUIREMENTS.md" exists

  Scenario: a collecting turn that leaves a thread ending in "H:" is refused
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^why]

      [^why]:
          - H: why not multiply?
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    When I run gtd land
    Then it fails
    And stderr contains "unanswered-threads"
    And stderr contains ".gtd/REVIEW.md:10: [^why]"
