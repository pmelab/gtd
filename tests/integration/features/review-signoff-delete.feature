@inmem
Feature: A step that deletes the steering file closes the review

  A run step that removes the review steering file lands, and the process
  moves on with the file gone. This scenario EXECUTES the rendered scripts.

  Scenario: the review is closed once the run step deletes the file
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, removeScript, run } from "@pmelab/gtd/flows"

      const REVIEW = ".gtd/REVIEW.md"

      export default async () => {
        await agent("reviewing", "Write .gtd/REVIEW.md.", { file: REVIEW })
        await human("await-review", {
          message: "Review the change.",
          file: REVIEW,
          acceptClean: true,
        })
        await run("closing", removeScript([REVIEW]), { label: "Closing the review" })
        await human("done", { message: "reviewed" })
      }
      """
    And a file ".gtd/REVIEW.md" with:
      """
      ## ❔ calc

      new add function

      - [ ] Looks good
      """
    And gtd lands "gtd(agent): reviewing → await-review"
    And I run the pin beat
    And ".gtd/REVIEW.md" is modified to:
      """
      ## ❔ calc

      new add function

      - [x] Looks good
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
