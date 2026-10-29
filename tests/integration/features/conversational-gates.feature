@inmem
Feature: Conversation threads at a gate — threads get replies, open threads block moving on

  A footnote written as a `- H:` thread waits on the agent: an agent turn
  that leaves one is refused (`requireReplies`). A thread whose last entry is
  the agent's waits on the human: every landing at the gate is refused
  (`requireThreadsClosed`) until the human replies with a conclusion or
  deletes it. A round that leaves the agent a thread to answer needs no
  ticked open question (`hasThreadFor`); any other edit does
  (`requireAnswers`).

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import {
        agent,
        changes,
        hasThreadFor,
        human,
        requireAnswers,
        requireReplies,
        requireThreadsClosed,
      } from "@pmelab/gtd/flows"

      const PLAN = ".gtd/PLAN.md"

      export default async () => {
        await human("idle", { message: "write .gtd/PLAN.md to start" })
        for (;;) {
          await agent("drafting", "Revise the plan; reply to each H: thread.", { file: PLAN, mode: "qa" })
          requireReplies(PLAN)
          await human("answering", {
            message: "Review the plan.",
            file: PLAN,
            mode: "qa",
            acceptClean: true,
          })
          requireThreadsClosed(PLAN)
          if (changes().length === 0) break
          if (!hasThreadFor("agent", PLAN)) requireAnswers(PLAN)
        }
        await human("done", { message: "plan accepted" })
      }
      """
    And a file ".gtd/PLAN.md" with:
      """
      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Greeting export

      Add a `greet()` export.
      """
    And gtd lands "gtd(human): idle → drafting"

  Scenario: a clean re-run at the gate accepts the plan
    Given ".gtd/PLAN.md" is modified to:
      """
      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Greeting export

      Add a `greet()` export. Keep it tiny.
      """
    And gtd lands "gtd(agent): drafting → answering"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): answering → done"

  Scenario: a clean re-run at the gate is refused while a thread waits on the human
    Given ".gtd/PLAN.md" is modified to:
      """
      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Greeting export

      Add a `greet()` export.[^why]

      [^why]:
          - H: why a function?
          - A: a constant cannot take a name later.
      """
    And gtd lands "gtd(agent): drafting → answering"
    When I run gtd land
    Then it fails
    And stderr contains "open-threads"
    And stderr contains ".gtd/PLAN.md:12: [^why]"
    And the last commit subject is "gtd(agent): drafting → answering"

  Scenario: a reply-only round returns to the agent, then to the same gate
    Given ".gtd/PLAN.md" is modified to:
      """
      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Greeting export

      Add a `greet()` export. Keep it tiny.
      """
    And gtd lands "gtd(agent): drafting → answering"
    And ".gtd/PLAN.md" is modified to:
      """
      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Greeting export

      Add a `greet()` export. Keep it tiny.[^why]

      [^why]:
          - H: why a function?
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): answering → drafting"
    Given ".gtd/PLAN.md" is modified to:
      """
      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Greeting export

      Add a `greet()` export. Keep it tiny.[^why]

      [^why]:
          - H: why a function?
          - A: a constant cannot take a name later.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): drafting → answering"

  Scenario: an agent turn that leaves a thread ending in "H:" is refused
    Given ".gtd/PLAN.md" is modified to:
      """
      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Greeting export

      Add a `greet()` export.[^why]

      [^why]:
          - H: why a function?
      """
    When I run gtd land
    Then it fails
    And stderr contains "unanswered-threads"
    And stderr contains ".gtd/PLAN.md:12: [^why]"

  Scenario: a round with no thread for the agent still needs every open question ticked
    Given ".gtd/PLAN.md" is modified to:
      """
      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Greeting export

      Add a `greet()` export. Keep it tiny.
      """
    And gtd lands "gtd(agent): drafting → answering"
    And ".gtd/PLAN.md" is modified to:
      """
      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Greeting export

      Add a `greet()` export. Keep it small.
      """
    When I run gtd land
    Then it fails
    And stderr contains "answer-completeness"

  Scenario: a partial reply is refused while another thread is open
    Given ".gtd/PLAN.md" is modified to:
      """
      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Greeting export

      Add a `greet()` export.[^a][^b]

      [^a]:
          - H: why a function?
          - A: a constant cannot take a name later.

      [^b]:
          - H: why exported?
          - A: callers need it.
      """
    And gtd lands "gtd(agent): drafting → answering"
    And ".gtd/PLAN.md" is modified to:
      """
      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Greeting export

      Add a `greet()` export.[^a][^b]

      [^a]:
          - H: why a function?
          - A: a constant cannot take a name later.
          - H: ok, agreed.

      [^b]:
          - H: why exported?
          - A: callers need it.
      """
    When I run gtd land
    Then it fails
    And stderr contains "[^b]"
    And stderr does not contain "[^a]"
