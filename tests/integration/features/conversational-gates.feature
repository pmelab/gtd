@inmem
Feature: Conversational gates — the gates always stop, threads get replies, open threads block moving on

  The requirements gate stops on every process, even with no open question.
  A footnote written as a `- H:` thread gets an `- A:` reply and the process
  rests at the same gate again. A thread whose last entry is the agent's is
  open: every landing at the gate is refused until the human replies with a
  conclusion or deletes the thread.

  Background:
    Given a test project
    And the workflow gtd install scaffolds
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → unwind"

    And the file "NOTE.md" is deleted

    And gtd lands "gtd(check): unwind → start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"

  Scenario: the design gate stops with no open question, and a clean re-run accepts the plan
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export. No open questions.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.answer"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → seam.naive"

  Scenario: a clean re-run at the design gate is refused while a thread is open
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.[^why]

      [^why]:
          - H: why a function?
          - A: a constant cannot take a name later.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    When I run gtd land
    Then it fails
    And stderr contains "open-threads"
    And stderr contains ".gtd/REQUIREMENTS.md:5: [^why]"
    And the last commit subject is "gtd(agent): design.triage → design.gate.answer"

  Scenario: a reply-only round at the design gate returns to the agent, then to the same gate
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.

      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Greeting export

      Add a `greet()` export.[^why]

      [^why]:
          - H: why a function?

      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → design.triage"
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Greeting export

      Add a `greet()` export.[^why]

      [^why]:
          - H: why a function?
          - A: a constant cannot take a name later.

      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.answer"

  Scenario: an agent turn that leaves a thread ending in "H:" is refused
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.[^why]

      [^why]:
          - H: why a function?

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    When I run gtd land
    Then it fails
    And stderr contains "unanswered-threads"
    And stderr contains ".gtd/REQUIREMENTS.md:5: [^why]"

  Scenario: a notes-only round at the design gate with no open question needs no tick
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Greeting export

      Add a `greet()` export. Keep it tiny.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → design.triage"

  Scenario: a round with no thread for the agent still needs every open question ticked
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.

      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Greeting export

      Add a `greet()` export. Keep it tiny.

      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    When I run gtd land
    Then it fails
    And stderr contains "answer-completeness"

  Scenario: a partial reply is refused while another thread is open
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.[^a][^b]

      [^a]:
          - H: why a function?
          - A: a constant cannot take a name later.

      [^b]:
          - H: why exported?
          - A: callers need it.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Greeting export

      Add a `greet()` export.[^a][^b]

      [^a]:
          - H: why a function?
          - A: a constant cannot take a name later.
          - H: ok, agreed.

      [^b]:
          - H: why exported?
          - A: callers need it.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    When I run gtd land
    Then it fails
    And stderr contains "[^b]"
    And stderr does not contain "[^a]"

  Scenario: a code `// H:` question alone at the design gate goes to design.triage, skipping the tick requirement
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.

      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    Given a file "src/calc.ts" with:
      """
      // H: why not multiply?
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → design.triage"
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Greeting export

      Revised.

      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    When I run gtd land
    Then it fails
    And stderr contains "unanswered-threads"
    And stderr contains "src/calc.ts:1"

  Scenario: an open code thread refuses landing at the design gate, naming path:line
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.

      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    Given a file "src/calc.ts" with:
      """
      // H: why not multiply?
      export const add = (a: number, b: number) => a + b
      """
    And gtd lands "gtd(human): design.gate.answer → design.triage"
    Given "src/calc.ts" is modified to:
      """
      // H: why not multiply?
      // A: this is the addition helper.
      export const add = (a: number, b: number) => a + b
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    When I run gtd land
    Then it fails
    And stderr contains "open-threads"
    And stderr contains "src/calc.ts:1"
