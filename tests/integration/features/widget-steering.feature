@inmem
Feature: steering steps — an agent step with a file writes widgets and nothing else

  An agent step that declares `file` (and no `mode`) is a steering step. gtd
  checks its turn itself: the file must exist and hold valid widgets, no
  annotation may be left in it, and the turn may change no other path. Every
  problem goes back to the agent in the same session; after the cap the
  process rests at `<step>.invalid`.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("plan", "write the plan", { file: ".gtd/PLAN.md", widgets: ["single-select"] })
        await human("answer", { message: "answer the plan", file: ".gtd/PLAN.md" })
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

  Scenario: a valid steering file completes the step
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan

      ## 🔘 Where is the counter stored?

      - [ ] Redis
      - [ ] ✏️
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): plan → answer"

  Scenario: a turn that writes no steering file is sent back
    Given a file ".gtd/OTHER.md" with:
      """
      notes
      """
    When I run gtd land
    Then it fails
    And stderr contains ".gtd/OTHER.md"

  Scenario: a broken widget goes back to the agent with its line
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan

      ## 🔘 Where is the counter stored?

      Redis or memory?
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "\"kind\":\"prompt\""
    And stdout contains ".gtd/PLAN.md:3: "
    And stdout contains "a 🔘 widget needs its checkbox list before the next heading"

  Scenario: a widget kind the step does not allow goes back to the agent
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan

      ## ❔ Ship it?

      - [ ] Yes
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "this step does not take a ❔ boolean widget; use single-select"

  Scenario: an annotation left in the file goes back to the agent
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan[^1]

      [^1]: Why?
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "annotation [^1] is still in the file"

  Scenario: after the cap the process rests at the invalid gate
    Given a file ".gtd/PLAN.md" with:
      """
      ## ❔ One?
      """
    When I run gtd land
    Given a file ".gtd/PLAN.md" with:
      """
      ## ❔ Two?
      """
    When I run gtd land
    Given a file ".gtd/PLAN.md" with:
      """
      ## ❔ Three?
      """
    When I run gtd land
    Given a file ".gtd/PLAN.md" with:
      """
      ## ❔ Four?
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "\"state\":\"plan.invalid\""

  Scenario: gtd next tells the driver the step writes only its steering file
    When I run gtd next with "--json"
    Then stdout contains "\"write\":[\".gtd/PLAN.md\"]"
