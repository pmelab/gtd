@inmem
Feature: requireProgress — deleting the feedback file without addressing it is refused

  `requireProgress(file)` refuses a turn that deletes `file` without folding
  it in — the "captured then discarded" guard. A file whose content is the
  `NOTHING ACTIONABLE` sentinel is the one exemption.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, requireProgress } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write .gtd/FEEDBACK.md, then run `gtd land`" })
        await agent("drafting", "address .gtd/FEEDBACK.md, then delete it", {
          file: ".gtd/FEEDBACK.md",
        })
        requireProgress(".gtd/FEEDBACK.md")
        await human("done", { message: "feedback addressed" })
      }
      """

  Scenario: deleting the feedback file without addressing it is refused
    Given a file ".gtd/FEEDBACK.md" with:
      """
      Rename the `add` export to `sum`.
      """
    And gtd lands "gtd(human): idle → drafting"
    And I run the pin beat
    And the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd land
    Then it fails
    And stderr contains "without addressing its instructions"
    And the last commit subject is "gtd(check): gtd:pin → drafting"

  Scenario: a NOTHING ACTIONABLE sentinel is the one exemption
    Given a file ".gtd/FEEDBACK.md" with:
      """
      NOTHING ACTIONABLE — the human left only an approving remark.
      """
    And gtd lands "gtd(human): idle → drafting"
    And I run the pin beat
    # The only pending change deletes .gtd/FEEDBACK.md, but its deleted
    # content IS the sentinel.
    And the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): drafting → done"
