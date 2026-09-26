@inmem
Feature: the return-lap stop is the human's silence, not a round cap

  `answerCompletenessGuard` (src/step/Guards.ts) yields when the pending diff
  is empty — the human landed the `mode: qa` answer gate untouched — even
  though its `## Open Questions` still holds an unticked question. That's the
  only stop the return-lap loop can reach (package 01): a partial edit, code
  included, still falls through to the ordinary refusal. The gate's
  `acceptClean: true` makes that clean landing complete the gate, so the
  process actually advances instead of the guard yielding to a no-op.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        for (;;) {
          await agent("drafting", "Draft the plan.", { file: ".gtd/TODO.md", mode: "qa" })
          await human("answering", {
            message: "Answer the open questions.",
            file: ".gtd/TODO.md",
            mode: "qa",
            answerGate: true,
            acceptClean: true,
          })
        }
      })
      """
    And a file ".gtd/TODO.md" with:
      """
      Build a thing.

      ## Open Questions

      ### Which API?

      - [ ] REST
      - [ ] GraphQL
      """
    And gtd lands "gtd(agent): drafting → answering"

  Scenario: a clean tree at the answer gate lands with the question still unanswered
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): answering → drafting"

  Scenario: editing the qa file itself with the question left unticked is still refused
    Given a file ".gtd/TODO.md" with:
      """
      Build a thing. (still deciding)

      ## Open Questions

      ### Which API?

      - [ ] REST
      - [ ] GraphQL
      """
    When I run gtd land
    Then it fails
    And stderr contains "answer-completeness"
    And stderr contains "1 open question(s)"
    And the last commit subject is "gtd(agent): drafting → answering"
