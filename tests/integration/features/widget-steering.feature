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

  Scenario: a turn that only reflows the steering file changes nothing
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan

      One short paragraph.
      """
    And gtd lands "gtd(agent): plan → answer"
    And I run gtd next
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan

      One short
      paragraph.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): plan → answer"

  Scenario: a person cannot land with a single select unanswered
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan

      ## 🔘 Where is the counter stored?

      - [ ] Redis
      - [ ] Memory
      """
    And gtd lands "gtd(agent): plan → answer"
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan

      Some more context from the person.

      ## 🔘 Where is the counter stored?

      - [ ] Redis
      - [ ] Memory
      """
    When I run gtd land
    Then it fails
    And stderr contains ".gtd/PLAN.md:5: \"Where is the counter stored?\": pick one option"

  Scenario: an annotation lets a person land without answering
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan

      ## 🔘 Where is the counter stored?

      - [ ] Redis
      - [ ] Memory
      """
    And gtd lands "gtd(agent): plan → answer"
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan

      ## 🔘 Where is the counter stored?[^1]

      - [ ] Redis
      - [ ] Memory

      [^1]: Why store a counter at all?
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): answer → done"

  Scenario: a person's answer lands in the file's canonical form
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan

      ## 🔘 Where is the counter stored?

      - [ ] Redis
      - [ ] Memory
      """
    And gtd lands "gtd(agent): plan → answer"
    Given a file ".gtd/PLAN.md" with:
      """
      # Plan

      ## 🔘 Where is the counter stored?

      - [x] Redis
      - [ ] Memory

      A note the person wrote
      over two lines.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): answer → done"
    And the file ".gtd/PLAN.md" contains "A note the person wrote over two lines."
