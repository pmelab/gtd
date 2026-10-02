@inmem
Feature: Conversational gates — the gates always stop, threads get replies, open threads block moving on

  The requirements and architecture gates stop on every process, even with
  no open question. A footnote written as a `- H:` thread gets an `- A:`
  reply and the process rests at the same gate again. A thread whose last
  entry is the agent's is open: every landing at the gate is refused until
  the human replies with a conclusion or deletes the thread.

  Background:
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"

  Scenario: the design gate stops with no open question, and a clean re-run accepts the plan
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export. No open questions.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.answer"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → architecture-pre"

  Scenario: a clean re-run at the design gate is refused while a thread is open
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.[^why]

      [^why]:
          - H: why a function?
          - A: a constant cannot take a name later.
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
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Greeting export

      Add a `greet()` export. Keep it tiny.
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
      """
    When I run gtd land
    Then it fails
    And stderr contains "[^b]"
    And stderr does not contain "[^a]"

  Scenario: the architecture gate stops with no open question, and refuses a clean re-run on an open thread
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    Given a file ".gtd/ARCHITECTURE.md" with:
      """
      ## Greeting export

      One module.[^why]

      [^why]:
          - H: why one module?
          - A: nothing to split yet.
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    When I run gtd land
    Then it fails
    And stderr contains ".gtd/ARCHITECTURE.md:5: [^why]"

  Scenario: a reply-only round at the architecture gate returns to the author, then to the same gate
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    Given a file ".gtd/ARCHITECTURE.md" with:
      """
      ## Greeting export

      One module.
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    Given ".gtd/ARCHITECTURE.md" is modified to:
      """
      ## Greeting export

      One module.[^why]

      [^why]:
          - H: why one module?
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): architecture.gate.answer → architecture.author"
    Given ".gtd/ARCHITECTURE.md" is modified to:
      """
      ## Greeting export

      One module.[^why]

      [^why]:
          - H: why one module?
          - A: nothing to split yet.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): architecture.author → architecture.gate.answer"

  Scenario: an architecture author turn that leaves a thread ending in "H:" is refused
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    Given a file ".gtd/ARCHITECTURE.md" with:
      """
      ## Greeting export

      One module.[^why]

      [^why]:
          - H: why one module?
      """
    When I run gtd land
    Then it fails
    And stderr contains "unanswered-threads"
    And stderr contains ".gtd/ARCHITECTURE.md:5: [^why]"

  Scenario: a code `// H:` question alone at the design gate goes to design.triage, skipping the tick requirement
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.

      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy
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

  Scenario: a code `// H:` question alone at the architecture gate goes to architecture.author, skipping the tick requirement
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      ## Greeting export

      One module.

      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    Given a file "src/calc.ts" with:
      """
      // H: why not multiply?
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): architecture.gate.answer → architecture.author"
    Given ".gtd/ARCHITECTURE.md" is modified to:
      """
      ## Greeting export

      Revised.

      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy
      """
    When I run gtd land
    Then it fails
    And stderr contains "unanswered-threads"
    And stderr contains "src/calc.ts:1"

  Scenario: an open code thread refuses landing at the architecture gate, naming path:line
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      ## Greeting export

      One module.

      ## Open Questions

      ### Which style?

      - [ ] plain
      - [ ] fancy
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    Given a file "src/calc.ts" with:
      """
      // H: why not multiply?
      export const add = (a: number, b: number) => a + b
      """
    And gtd lands "gtd(human): architecture.gate.answer → architecture.author"
    Given "src/calc.ts" is modified to:
      """
      // H: why not multiply?
      // A: this is the addition helper.
      export const add = (a: number, b: number) => a + b
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.answer"
    When I run gtd land
    Then it fails
    And stderr contains "open-threads"
    And stderr contains "src/calc.ts:1"
