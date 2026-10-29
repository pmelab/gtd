@inmem
Feature: A step that deletes its review file lands even when its mode declares a format: command that fails on a missing file

  `gtd land`'s emitted script is only the HEAD assertion and the commit — a
  mode's `format:`/`validate:` pair is never part of it, so a formatter that
  exits non-zero on a missing path (`prettier --write`, modelled below) cannot
  make a step whose only change deletes the state's `file:` unlandable. This
  scenario EXECUTES the rendered scripts.

  Scenario: the review is closed even though the review mode's format command fails on the missing file
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, removeScript, run } from "@pmelab/gtd/flows"

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
        await human("done", { message: "reviewed" })
      }

      export const config = {
        modes: {
          review: {
            format: `test -f $GTD_FILE || {
        echo "No files matching the pattern were found: $GTD_FILE" >&2
        exit 2
      }
      `,
          },
        },
      }
      """
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1-1
      new add function
      """
    And gtd lands "gtd(agent): reviewing → await-review"
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
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): closing → done"
    And ".gtd/REVIEW.md" does not exist
