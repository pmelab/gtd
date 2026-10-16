@inmem
Feature: the risk tier is proposed at triage and recorded behind GTD_FLAG_RISK_TIER

  With GTD_FLAG_NAIVE_PASS and GTD_FLAG_RISK_TIER both on, design.triage asks
  for a risk tier and production signals, and the design gate's exit lands them
  as Gtd-Mark trailers: one `risk-tier=<low|high>`, one `production-signal`
  per signal. A missing or unreadable tier is high. With the flag off, nothing
  is asked and no commit carries a Gtd-Mark.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_NAIVE_PASS" set to "1"

  Rule: with GTD_FLAG_RISK_TIER on

    Background:
      Given an environment variable "GTD_FLAG_RISK_TIER" set to "1"
      And a file "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        """
      And a file "src/calc.test.ts" with:
        """
        import { expect, it } from "vitest"
        it("adds", () => expect(1 + 1).toBe(2))
        """
      And the working tree is committed as "feat: add calculator"
      And a file "TODO.md" with:
        """
        # Add subtract

        subtract(a, b) returns the difference.
        """
      And step "unwind" changes nothing
      And step "start-gate.check" changes nothing

    Scenario: with both flags on the triage prompt asks for the tier and the signals
      When the process is driven
      Then the process rests at "design.triage"
      And the resting step's content contains "## Risk Tier"
      And the resting step's content contains "## Production Signals"
      And the resting step's content contains "unsure means `high`"

    Scenario: a low tier marks risk-tier=low on the design-exit commit
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Risk Tier

        low — trivial copy change
        """
      And step "design.gate.answer" changes nothing
      When the process is driven
      Then the process rests at "seam.naive"
      And the last commit subject is "gtd(human): design.gate.answer → seam.naive"
      And the last commit body contains "Gtd-Mark: risk-tier=low"

    Scenario: a high tier marks the design-exit commit
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Risk Tier

        high — touches payments
        """
      And step "design.gate.answer" changes nothing
      When the process is driven
      Then the process rests at "seam.naive"
      And the last commit subject is "gtd(human): design.gate.answer → seam.naive"
      And the last commit body contains "Gtd-Mark: risk-tier=high"

    Scenario Outline: a missing section or an unknown word counts as high
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        <tier section>
        ## Concerns

        ### Subtract
        """
      And step "design.gate.answer" changes nothing
      When the process is driven
      Then the process rests at "seam.naive"
      And the last commit body contains "Gtd-Mark: risk-tier=high"

      Examples:
        | tier section                  |
        |                               |
        | ## Risk Tier\n\nmedium — hmm |
        | ```\n## Risk Tier\n\nlow\n```\n |

    Scenario Outline: signals written at triage land as marks for either tier
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Risk Tier

        <tier> — reason

        ## Production Signals

        - error rate on /subtract stays flat
        - p95 latency
        """
      And step "design.gate.answer" changes nothing
      When the process is driven
      Then the process rests at "seam.naive"
      And the last commit body contains "Gtd-Mark: production-signal=error rate on /subtract stays flat"
      And the last commit body contains "Gtd-Mark: production-signal=p95 latency"

      Examples:
        | tier |
        | low  |
        | high |

    Scenario Outline: low and high processes produce the same commit subjects to implement.building
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Risk Tier

        <tier> — reason
        """
      And step "design.gate.answer" changes nothing
      And step "seam.naive" writes "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        export const subtract = (a: number, b: number) => a - b
        """
      And judge step "seam.judge" answers:
        """
        [{"id":"shape","answer":"land","p":0.9}]
        """
      When the process is driven
      Then the process rests at "implement.building"
      And the commit subjects end with:
        """
        gtd(agent): design.triage → design.gate.answer
        gtd(human): design.gate.answer → seam.naive
        gtd(agent): seam.naive → seam.judge
        gtd(judge): seam.judge → implement.building
        """

      Examples:
        | tier |
        | low  |
        | high |

    Scenario Outline: the implementation prompt demands a flag for high and none for low
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Risk Tier

        <tier> — reason
        """
      And step "design.gate.answer" changes nothing
      And step "seam.naive" writes "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        export const subtract = (a: number, b: number) => a - b
        """
      And judge step "seam.judge" answers:
        """
        [{"id":"shape","answer":"land","p":0.9}]
        """
      When the process is driven
      Then the process rests at "implement.building"
      And the resting step's content contains "<demand>"
      And the resting step's content does not contain "<absent>"

      Examples:
        | tier | demand                                                | absent                |
        | high | Put the new behaviour behind a new release flag       | Add no release flag   |
        | low  | Add no release flag — this change is low risk tier    | new release flag      |

    Scenario: the tier comes from the requirements the final design gate lap accepted
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Risk Tier

        low — trivial copy change
        """
      And step "seam.naive" writes "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        export const subtract = (a: number, b: number) => a - b
        """
      And judge step "seam.judge" answers:
        """
        [{"id":"shape","answer":"land","p":0.9}]
        """
      When the process is driven
      Then the process rests at "design.gate.answer"
      Given a file ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Risk Tier

        high — touches payments
        """
      And step "design.triage" from now on changes nothing
      And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Risk Tier

        high — touches payments

        ## Concerns

        ### Subtract
        """
      And step "design.gate.answer" changes nothing
      When the process is driven
      Then the process rests at "implement.building"
      And the resting step's content contains "Put the new behaviour behind a new release flag"
      And the resting step's content does not contain "Add no release flag"

  Rule: with GTD_FLAG_RISK_TIER off

    Background:
      Given an environment variable "GTD_FLAG_RISK_TIER" set to "0"
      And a file "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        """
      And a file "src/calc.test.ts" with:
        """
        import { expect, it } from "vitest"
        it("adds", () => expect(1 + 1).toBe(2))
        """
      And the working tree is committed as "feat: add calculator"
      And a file "TODO.md" with:
        """
        # Add subtract

        subtract(a, b) returns the difference.
        """
      And step "unwind" changes nothing
      And step "start-gate.check" changes nothing

    Scenario: the flag-off twin asks for no tier and marks no commit
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Risk Tier

        low — trivial

        ## Production Signals

        - error rate stays flat
        """
      And step "design.gate.answer" changes nothing
      When the process is driven
      Then the process rests at "seam.naive"
      And no commit body contains "Gtd-Mark"

    Scenario: the flag-off twin's triage prompt has no tier section
      When the process is driven
      Then the process rests at "design.triage"
      And the resting step's content does not contain "## Risk Tier"
      And the resting step's content does not contain "## Production Signals"


    Scenario: the flag-off twin keeps today's flag demand
      Given step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Risk Tier

        low — trivial
        """
      And step "design.gate.answer" changes nothing
      And step "seam.naive" writes "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        export const subtract = (a: number, b: number) => a - b
        """
      And judge step "seam.judge" answers:
        """
        [{"id":"shape","answer":"land","p":0.9}]
        """
      When the process is driven
      Then the process rests at "implement.building"
      And the resting step's content contains "Put the new behaviour behind a new release flag"
      And the resting step's content does not contain "Add no release flag"
