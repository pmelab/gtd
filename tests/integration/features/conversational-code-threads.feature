@inmem
Feature: Code threads — an H:/A: conversation in line comments of changed code

  A run of line comments opening with `H:` in a file changed in the current
  process is a thread, like a footnote thread: an agent turn that leaves one
  ending in `H:` is refused, and one whose last entry is the agent's refuses
  landing at the gate, naming `path:line`. A file the process did not change
  holds no thread. `gtd check --open-threads` alone lists the open ones.

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

  Scenario: a thread in a file the process did not change is no thread
    Given a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      // H: why not multiply?
      // A: this is the addition helper.
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
    And I run the pin beat
    And ".gtd/PLAN.md" is modified to:
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

  Rule: the process changed the calculator

    Background:
      Given a commit "feat: add calculator" that adds "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
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
      And I run the pin beat
      And ".gtd/PLAN.md" is modified to:
        """
        ## Open Questions

        ### Which style?

        - [ ] plain
        - [ ] fancy

        ## Greeting export

        Add a `greet()` export. Keep it tiny.
        """
      And gtd lands "gtd(agent): drafting → answering"

    Scenario: a code H: question alone needs no tick, and the agent turn must answer it
      Given "src/calc.ts" is modified to:
        """
        // H: why not multiply?
        export const add = (a: number, b: number) => a + b
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

        Add a `greet()` export. Revised.
        """
      When I run gtd land
      Then it fails
      And stderr contains "unanswered-threads"
      And stderr contains "src/calc.ts:1: why not multiply?"

    Scenario: an answered code thread refuses landing at the gate, naming path:line
      Given "src/calc.ts" is modified to:
        """
        export const add = (a: number, b: number) => a + b
        // H: why not multiply?
        """
      And gtd lands "gtd(human): answering → drafting"
      And "src/calc.ts" is modified to:
        """
        export const add = (a: number, b: number) => a + b
        // H: why not multiply?
        // A: this is the addition helper.
        """
      And gtd lands "gtd(agent): drafting → answering"
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
