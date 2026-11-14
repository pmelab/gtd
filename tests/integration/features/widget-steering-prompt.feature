@inmem
Feature: a steering step's prompt — gtd's rules and what the person changed

  gtd opens every steering step's prompt with its own rules: write only the
  steering file, ask nothing in chat, work annotations in, and a reference of
  every widget. When the person's last turn changed the file, the prompt also
  shows the lines they changed.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, annotations, human, widgets } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        for (;;) {
          await agent("plan", "write the plan", { file: ".gtd/PLAN.md" })
          await human("answer", { message: "answer the plan", file: ".gtd/PLAN.md" })
          if (annotations(widgets(".gtd/PLAN.md")).length === 0) break
        }
        await human("done", "finished")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → plan"
    And I run the pin beat

  Scenario: the prompt opens with gtd's rules, then the workflow's prompt
    When I run gtd next with "--json=content"
    Then it succeeds
    And stdout contains "This step writes .gtd/PLAN.md, a steering file."
    And stdout contains "Ask nothing in chat."
    And stdout contains "## 🔘 A single select"
    And stdout contains "write the plan"

  Scenario: an annotation sends the plan back, and the prompt shows the person's lines
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan

      Use Redis.
      """
    And gtd lands "gtd(agent): plan → answer"
    And a file ".gtd/PLAN.md" with:
      """
      # Plan

      Use Redis.[^1]

      [^1]: Why not memory?
      """
    And gtd lands "gtd(human): answer → plan"
    When I run gtd next with "--json=content"
    Then it succeeds
    And stdout contains "The person edited .gtd/PLAN.md since you last wrote it."
    And stdout contains "+ [^1]: Why not memory?"
