@inmem
Feature: gtd mermaid — the active workflow's shape as Mermaid stateDiagram-v2 source

  `gtd mermaid` (see src/Mermaid.ts) renders the active workflow's SHAPE —
  states, `on` edges, initial-state marker, commit-state finality, and each
  rest's actor/content-kind/retry summary — as Mermaid `stateDiagram-v2`
  source. It never resolves HEAD and never mutates the repository: its output
  depends only on the compiled `WorkflowDefinition`, not on the current
  process/branch state.

  Scenario: the bundled simple template renders every state, the initial marker, and a commit-state finality edge
    Given a test project
    And the workflow
    When I run gtd with args "mermaid"
    Then it succeeds
    And stdout contains "stateDiagram-v2"
    And stdout contains "state \"idle\" as idle"
    And stdout contains "state \"grilling\" as grilling"
    And stdout contains "state \"grilling-answer\" as grilling_answer"
    And stdout contains "state \"start-check\" as start_check"
    And stdout contains "state \"fix-check\" as fix_check"
    And stdout contains "[*] --> idle"
    And stdout contains "idle --> start_check : * **"
    And stdout contains "idle --> adv_start_check : * .gtd/REQUIREMENTS.md"
    And stdout contains "start_check --> grilling : C"
    And stdout contains "start_check --> start_blocked : A .gtd/FEEDBACK.md"
    And stdout contains "fix_check --> fixing : A .gtd/FEEDBACK.md"
    And stdout contains "fix_check --> idle : C"
    And stdout contains "grilling --> grilling_answer : * **"
    And stdout contains "note right of fixing : agent · prompt · retry 3→escalate"

  Scenario: a custom workflow's shape — including a hyphenated state name and a retry cap — renders correctly
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          start:
            actor: human
            initial: true
            message: "go"
            on:
              "* **": checking
          checking:
            actor: check
            script: "npm test"
            on:
              "A FEEDBACK.md": fixing
              "C": done
          fixing:
            actor: agent
            retry:
              max: 2
              otherwise: escalate
            prompt: "fix it"
            on:
              "* **": checking
          escalate:
            actor: human
            message: "stuck"
            on:
              "* **": checking
          done:
            commit: "chore: done"
      """
    When I run gtd with args "mermaid"
    Then it succeeds
    And stdout contains "[*] --> start"
    And stdout contains "start --> checking : * **"
    And stdout contains "checking --> fixing : A FEEDBACK.md"
    And stdout contains "checking --> done : C"
    And stdout contains "done --> [*]"
    And stdout contains "note right of fixing : agent · prompt · retry 2→escalate"
    And stdout does not contain "note right of done"

  Scenario: gtd mermaid rejects --json — there is no structured shape beyond the Mermaid source itself
    Given a test project
    When I run gtd with args "mermaid --json"
    Then it fails
    And stderr contains "gtd mermaid does not accept --json"

  Scenario: gtd mermaid rejects extra arguments
    Given a test project
    When I run gtd with args "mermaid bogus"
    Then it fails

  Scenario: gtd mermaid authors nothing, regardless of the repo's current state
    Given a test project
    And the workflow
    And a file ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    And I record the commit count
    When I run gtd with args "mermaid"
    Then it succeeds
    And the commit count is unchanged
    And ".gtd/TODO.md" exists
