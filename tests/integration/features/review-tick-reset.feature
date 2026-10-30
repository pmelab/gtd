@inmem
Feature: Review checkboxes reset on land — a tick is read-progress, never sign-off

  At a human gate whose file is in `mode: review`, `gtd land`'s emitted
  script resets every `- [x]`/`- [X]` file-pointer box back to `- [ ]` (via
  `gtd uncheck`) BEFORE it commits — no record of which hunks were read
  survives the land, in history or on disk. `qa`-mode's `- [ ]` boxes ARE the
  answer, so `gtd uncheck` never runs at a `qa`-mode gate.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, removeScript, run, workflow } from "@pmelab/gtd/flows"

      const REVIEW = ".gtd/REVIEW.md"

      export default async () => {
        await agent("reviewing", "Write .gtd/REVIEW.md.", { file: REVIEW, mode: "review" })
        await human("await-review", {
          message: "Review the change.",
          file: REVIEW,
          mode: "review",
          acceptClean: true,
        })
        await run("closing", removeScript([REVIEW]), { label: "Closing the review" })
      }

      export const answer = workflow(async () => {
        await agent("drafting", "Draft the plan.", { file: ".gtd/PLAN.md", mode: "qa" })
        await human("answering", {
          message: "Answer the open questions.",
          file: ".gtd/PLAN.md",
          mode: "qa",
        })
        await agent("revising", "Revise the plan.", { file: ".gtd/PLAN.md", mode: "qa" })
      })
      """
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """

  Scenario: ticking boxes and changing nothing else lands no tick — the ticks are gone from disk
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      new add function
      """
    And gtd lands "gtd(agent): reviewing → await-review"
    And I run the pin beat
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1-1
      new add function
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): await-review → closing"
    And ".gtd/REVIEW.md" contains "- [ ] ./src/calc.ts#1-1"
    And ".gtd/REVIEW.md" does not contain "[x]"
    And the git status is clean
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And ".gtd/REVIEW.md" does not exist

  Scenario: ticking boxes and leaving a note commits the note, never the tick
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      new add function
      """
    And gtd lands "gtd(agent): reviewing → await-review"
    And I run the pin beat
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [X] ./src/calc.ts#1-1
      new add function — rename it to sum
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): await-review → closing"
    And ".gtd/REVIEW.md" contains "- [ ] ./src/calc.ts#1-1"
    And ".gtd/REVIEW.md" contains "rename it to sum"
    And ".gtd/REVIEW.md" does not contain "[X]"
    And the git status is clean

  Scenario: a ticked two-space-indented (nested) pointer is cleared too
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
        - [ ] ./src/calc.ts#2
      """
    And gtd lands "gtd(agent): reviewing → await-review"
    And I run the pin beat
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
        - [x] ./src/calc.ts#2
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): await-review → closing"
    And ".gtd/REVIEW.md" contains "  - [ ] ./src/calc.ts#2"
    And ".gtd/REVIEW.md" does not contain "[x]"

  Scenario: a '- [x]' line inside a fenced code block is never a hunk pointer, and ticking the chunk never touches it
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      Example of the OLD format, quoted for context:

      ```
      - [x] ./src/legacy.ts#1
      ```

      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): reviewing → await-review"
    And I run the pin beat
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      Example of the OLD format, quoted for context:

      ```
      - [x] ./src/legacy.ts#1
      ```

      - [x] ./src/calc.ts#1
      new add function
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): await-review → closing"
    And ".gtd/REVIEW.md" contains "- [ ] ./src/calc.ts#1"
    And ".gtd/REVIEW.md" contains "- [x] ./src/legacy.ts#1"

  Scenario: a ticked answer at a qa-mode gate survives the land — gtd uncheck never runs there
    When I run gtd with args "start answer"
    Then it succeeds
    And I run the pin beat
    Given a file ".gtd/PLAN.md" with:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    And gtd lands "gtd(agent): drafting → answering"
    And ".gtd/PLAN.md" is modified to:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [x] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): answering → revising"
    And ".gtd/PLAN.md" contains "[x] SQLite"
