@inmem
Feature: the return-lap stop is the human's silence, not a round cap

  `answerCompletenessGuard` (src/step/Guards.ts) yields when the pending diff
  is empty — the human landed the `mode: qa` answer gate untouched — even
  though its `## Open Questions` still holds an unticked question. That's the
  only stop the return-lap loop can reach (package 01): a partial edit, code
  included, still falls through to the ordinary refusal. The gate's own `"C"`
  row (added alongside the guard) routes that clean-tree case to the same
  target its `"* **"` row does, so the process actually advances instead of
  the guard yielding to a step that never fires.

  Background:
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: drafting
            states:
              drafting:
                actor: agent
                prompt: "Draft the plan."
                file: TODO.md
                mode: qa
                on:
                  "* **": answering
              answering:
                actor: human
                message: "Answer the open questions."
                file: TODO.md
                mode: qa
                answerGate: true
                on:
                  "C":
                    to: drafting
                    action: Accept as-is
                    describe: "change nothing and re-run to advance with the questions unanswered."
                  "* **": drafting
      """
    And a commit "gtd(agent): answering" that adds ".gtd/TODO.md" with:
      """
      Build a thing.

      ## Open Questions

      ### Which API?

      - [ ] REST
      - [ ] GraphQL
      """

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
    And the last commit subject is "gtd(agent): answering"
