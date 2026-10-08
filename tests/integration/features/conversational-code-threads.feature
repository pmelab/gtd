@inmem
Feature: Code threads — an H:/A: conversation in line comments of changed code

  A run of line comments opening with `H:` in a file changed in the current
  process is a thread, like a footnote thread: the agent answers a question
  with one `A:` comment line below it and the process rests at the review gate
  again — no lap. A thread whose last entry is the agent's is open and refuses
  landing. `gtd check --open-threads` alone lists the open ones.

  Background:
    Given a test project
    And the workflow
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

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"

  Scenario: a code thread question gets one A: reply and the gate rests again, no lap
    Given "src/calc.ts" is modified to:
      """
      // H: why not multiply?
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.collecting"
    Given "src/calc.ts" is modified to:
      """
      // H: why not multiply?
      // A: this is the addition helper.
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → build.review.await-review"
    And ".gtd/REQUIREMENTS.md" does not exist
    And ".gtd/REVIEW.md" exists

  Scenario: a concluded code thread is folded into requirements and its lines deleted
    Given "src/calc.ts" is modified to:
      """
      // H: why not multiply?
      // A: this is the addition helper.
      // H: then add a subtract function too
      export const add = (a: number, b: number) => a + b
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Subtract

      Export `subtract()`. TECHNICAL.
      """
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → build.review.closing"
    And ".gtd/REQUIREMENTS.md" exists
    And "src/calc.ts" does not contain "H:"

  Scenario: an open code thread refuses landing, naming path:line
    Given "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // H: why not multiply?
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // H: why not multiply?
      // A: this is the addition helper.
      """
    And gtd lands "gtd(agent): build.review.collecting → build.review.await-review"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [x] ./src/calc.ts#1
      new add function
      """
    When I run gtd land
    Then it fails
    And stderr contains "open-threads"
    And stderr contains "src/calc.ts:2"

  Scenario: bare gtd check --open-threads lists an open code thread
    Given "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // H: why not multiply?
      // A: this is the addition helper.
      """
    When I run gtd with args "check --open-threads"
    Then it fails
    And stderr contains "src/calc.ts:2: why not multiply?"

  Scenario: a round mixing a thread with a real code edit still counts the edit and takes the lap
    Given "src/calc.ts" is modified to:
      """
      // H: why not multiply?
      export const add = (a: number, b: number) => b + a
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Commutative add

      The reviewer rewrote `add` as `b + a`. TECHNICAL.
      """
    And "src/calc.ts" is modified to:
      """
      // H: why not multiply?
      // A: this is the addition helper.
      export const add = (a: number, b: number) => b + a
      """
    And gtd lands "gtd(agent): build.review.collecting → build.review.await-review"
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => b + a
      """
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [x] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → re-unwind"
    And "src/calc.ts" contains "b + a"
