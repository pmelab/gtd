@inmem
Feature: acceptance criteria carry stable IDs, and a sketch that states clear ones skips design

  `.gtd/REQUIREMENTS.md` lists the change's acceptance criteria as
  `- AC-<n>: …` under `## Acceptance Criteria`. On the full path
  `design.triage` writes them and the design gate settles them; a sketch
  that already states its criteria under an `Acceptance criteria` heading
  is judged at `design.clear`, and a `yes` records them as they are — no
  triage, no design gate. After design they are frozen.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_RISK_TIER" set to "0"
    And a file "src/greeting.ts" with:
      """
      export const greeting = "Helo, world"
      """
    And the working tree is committed as "feat: add greeting"
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing

  Rule: the full path

    Background:
      Given a file "TODO.md" with:
        """
        # Fix the typo

        greeting says "Helo"; make it "Hello".
        """

    Scenario: [AC-6] triage writes ID'd criteria that reach the naive pass through the design gate
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Impact

        - the greeting module

        ## Release Flag

        new

        ## Acceptance Criteria

        - AC-1: `greeting` reads "Hello, world".
        - AC-2: no other export changes.
        """
      And step "design.gate.answer" changes nothing
      When the process is driven
      Then the process rests at "seam.naive"
      And ".gtd/REQUIREMENTS.md" contains "- AC-1: `greeting` reads \"Hello, world\"."
      And ".gtd/REQUIREMENTS.md" contains "- AC-2: no other export changes."
      And the resting step's content contains "maps where the change lands"
      And the resting step's content contains "Acceptance Criteria"
      And the commit subjects end with:
        """
        gtd(check): start-gate.check → design.triage
        gtd(agent): design.triage → design.gate.answer
        gtd(human): design.gate.answer → seam.naive
        """

    Scenario: a triage turn whose criteria carry no ID is refused
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Impact

        - the greeting module

        ## Release Flag

        new

        ## Acceptance Criteria

        - `greeting` reads "Hello, world".
        """
      Then driving the process is refused with "acceptance-criteria: .gtd/REQUIREMENTS.md has 1 criterion without an ID"

    Scenario: a triage turn reusing an ID is refused
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Impact

        - the greeting module

        ## Release Flag

        new

        ## Acceptance Criteria

        - AC-1: `greeting` reads "Hello, world".
        - AC-1: no other export changes.
        """
      Then driving the process is refused with "duplicate IDs: AC-1"

    Scenario: an implementation turn that edits the settled criteria is refused
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Impact

        - the greeting module

        ## Release Flag

        new

        ## Acceptance Criteria

        - AC-1: `greeting` reads "Hello, world".
        """
      And step "design.gate.answer" changes nothing
      And step "seam.naive" writes "src/acceptance.test.ts" with:
        """
        it("[AC-1] holds", () => {})
        it("[AC-2] holds", () => {})
        it("[AC-3] holds", () => {})
        it("[AC-7] holds", () => {})
        """
      And step "seam.naive" writes "src/greeting.ts" with:
        """
        export const greeting = "Hello, world"
        """
      And step "seam.check" writes "src/acceptance.test.ts" with:
        """
        it("[AC-1] holds elsewhere", () => {})
        """
      And judge step "seam.judge" answers:
        """
        [{"id":"shape","answer":"land","p":0.9}]
        """
      And step "implement.applying" runs its script
      And step "implement.building" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Impact

        - the greeting module

        ## Release Flag

        new

        ## Acceptance Criteria

        - AC-1: `greeting` reads "Hi".
        """
      Then driving the process is refused with "criteria-frozen"

  Rule: impact

    Scenario: [AC-1] a triage turn with no Impact section is refused, naming it
      Given a file "TODO.md" with:
        """
        # Fix the typo

        greeting says "Helo"; make it "Hello".
        """
      And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Release Flag

        new

        ## Acceptance Criteria

        - AC-1: `greeting` reads "Hello, world".
        """
      Then driving the process is refused with "impact: .gtd/REQUIREMENTS.md has no \"## Impact\" section"

    Scenario: [AC-9] a design.impact turn that changes the criteria is refused
      Given a file "TODO.md" with:
        """
        # Fix the typo

        ## Acceptance criteria

        - `greeting` reads "Hello, world".
        """
      And judge step "design.clear" answers:
        """
        [{"id":"clear","answer":"yes","p":0.9}]
        """
      And step "design.normalise" runs its script
      And step "design.impact" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Impact

        - the greeting module

        ## Release Flag

        new

        ## Acceptance Criteria

        - AC-1: `greeting` reads "Hi".
        """
      Then driving the process is refused with "criteria-frozen"

    Scenario: [AC-9] a design.impact turn that adds no Impact section is refused
      Given a file "TODO.md" with:
        """
        # Fix the typo

        ## Acceptance criteria

        - `greeting` reads "Hello, world".
        """
      And judge step "design.clear" answers:
        """
        [{"id":"clear","answer":"yes","p":0.9}]
        """
      And step "design.normalise" runs its script
      And step "design.impact" appends to ".gtd/REQUIREMENTS.md":
        """
        Touches the greeting module.
        """
      Then driving the process is refused with "impact: .gtd/REQUIREMENTS.md has no \"## Impact\" section"

    Scenario: [AC-9] a design.impact turn that drops the sketch pointer is refused
      Given a file "TODO.md" with:
        """
        # Fix the typo

        ## Acceptance criteria

        - `greeting` reads "Hello, world".
        """
      And judge step "design.clear" answers:
        """
        [{"id":"clear","answer":"yes","p":0.9}]
        """
      And step "design.normalise" runs its script
      And step "design.impact" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Impact

        - the greeting module

        ## Release Flag

        new

        ## Acceptance Criteria

        - AC-1: `greeting` reads "Hello, world".
        """
      Then driving the process is refused with "impact-only"

  Rule: the skip path

    Scenario: [AC-9] [AC-10] clear stated criteria are normalised into ID'd requirements with no triage and no design gate
      Given a file "TODO.md" with:
        """
        # Fix the typo

        ## Acceptance criteria

        - [ ] `greeting` reads "Hello, world".
        - [ ] no other export changes.
        """
      And judge step "design.clear" answers:
        """
        [{"id":"clear","answer":"yes","p":0.9}]
        """
      And step "design.normalise" runs its script
      And step "design.impact" appends to ".gtd/REQUIREMENTS.md":
        """
        ## Impact

        - the greeting module
        """
      When the process is driven
      Then the process rests at "seam.naive"
      And ".gtd/REQUIREMENTS.md" contains "- AC-1: `greeting` reads \"Hello, world\"."
      And ".gtd/REQUIREMENTS.md" contains "- AC-2: no other export changes."
      And ".gtd/REQUIREMENTS.md" contains "Stated in `TODO.md` by the sketch"
      And the resting step's content contains "maps where the change lands"
      And the commit subjects end with:
        """
        gtd(human): idle → unwind
        gtd(check): unwind → start-gate.check
        gtd(check): start-gate.check → design.clear
        gtd(judge): design.clear → design.normalise
        gtd(check): design.normalise → design.impact
        gtd(agent): design.impact → seam.naive
        """

    Scenario: a fast-path process recorded before design.impact existed fails replay
      Given a file "TODO.md" with:
        """
        # Fix the typo

        ## Acceptance criteria

        - `greeting` reads "Hello, world".
        """
      And judge step "design.clear" answers:
        """
        [{"id":"clear","answer":"yes","p":0.9}]
        """
      And step "design.normalise" runs its script
      When the process is driven
      Then the process rests at "design.impact"
      Given the working tree is committed with the message:
        """
        gtd(agent): seam.naive → seam.check

        Gtd-Step: seam.naive#1
        Gtd-Format: 1
        """
      Then driving the process is refused with "the workflow changed under this process"

    Scenario: IDs the sketch already gave its criteria are kept
      Given a file "TODO.md" with:
        """
        ## Acceptance criteria

        1. AC-3: `greeting` reads "Hello, world".
        2. AC-7: no other export changes.
        """
      And judge step "design.clear" answers:
        """
        [{"id":"clear","answer":"yes","p":0.9}]
        """
      And step "design.normalise" runs its script
      And step "design.impact" appends to ".gtd/REQUIREMENTS.md":
        """
        ## Impact

        - the greeting module
        """
      When the process is driven
      Then the process rests at "seam.naive"
      And ".gtd/REQUIREMENTS.md" contains "- AC-3: `greeting` reads \"Hello, world\"."
      And ".gtd/REQUIREMENTS.md" contains "- AC-7: no other export changes."

    Scenario: one criterion the judge finds uncheckable falls back to the full path
      Given a file "TODO.md" with:
        """
        # Fix the typo

        ## Acceptance criteria

        - `greeting` reads "Hello, world".
        - the greeting feels friendlier.
        """
      And judge step "design.clear" answers:
        """
        [{"id":"clear","answer":"no","p":0.9}]
        """
      When the process is driven
      Then the process rests at "design.triage"
      And the commit subjects end with:
        """
        gtd(check): start-gate.check → design.clear
        gtd(judge): design.clear → design.triage
        """

    Scenario: a sketch with no criteria heading goes straight to triage, unjudged
      Given a file "TODO.md" with:
        """
        # Fix the typo

        - `greeting` reads "Hello, world".
        """
      When the process is driven
      Then the process rests at "design.triage"
      And the commit subjects end with:
        """
        gtd(check): start-gate.check → design.triage
        """
