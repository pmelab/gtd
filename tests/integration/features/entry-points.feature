@inmem
Feature: Entry points — which steering file the dirty tree contains picks the phase a cycle starts at

  A human's `gtd step human` on a dirty tree at a boundary HEAD is the v2 entry
  turn. WHICH gate it is captured under is driven purely by steering-file
  presence (never content), so a cycle can start at any phase:

  | file in the dirty tree | entry                                            |
  | none (plain notes)     | product grilling (`gtd(human): grilling`)        |
  | .gtd/TODO.md           | product grilling (the draft product plan)        |
  | .gtd/ARCHITECTURE.md   | technical grilling (`gtd(human): architecting`)  |
  | .gtd/PLAN.md           | decomposition (`gtd(human): grilled`)            |
  | .gtd/HEALTH.md         | error fixing (`gtd(human): health-fixing`)       |

  A `.gtd/PLAN.md` is a FINAL architecture: the entry turn commits it, then a
  mid-chain hop seeds `.gtd/ARCHITECTURE.md` from it (deleting PLAN.md) and
  routes straight to the decompose rest — no grilling round ever runs. A
  hand-written `.gtd/HEALTH.md` is an error description: the entry turn
  commits it and rests at health-fixing for the agent; the normal health
  detour (fix → re-test → cap/escalate → squash/learning tail) takes over.
  The entry files are pairwise illegal combinations, so the pick is always
  unambiguous.

  Scenario: A dirty tree seeded with PLAN.md enters directly at decomposition
    Given a test project
    And a file ".gtd/PLAN.md" with:
      """
      # Plan

      Split the calculator into parser and evaluator modules.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    And the git log contains "gtd(human): grilled"
    And the git log does not contain "gtd(human): grilling"
    And the git log does not contain "gtd(human): architecting"
    And the file ".gtd/PLAN.md" does not exist
    And the file ".gtd/ARCHITECTURE.md" exists
    And the file ".gtd/ARCHITECTURE.md" contains "Split the calculator into parser and evaluator modules."
    And the file ".gtd/ARCHITECTURE.md" contains "seeded from the final plan"
    When I run gtd next
    Then it succeeds
    And stdout contains "Decompose it into an ordered set of"

  Scenario: The PLAN.md entry proceeds through decompose into planning with no further special-casing
    Given a test project
    And a file ".gtd/PLAN.md" with:
      """
      # Plan

      Split the calculator into parser and evaluator modules.
      """
    And I run gtd step human
    And a file ".gtd/01-parser/01-extract-parser.md" with:
      """
      # Extract the parser

      - [ ] parser.ts exists
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): grilled"
    And the last commit subject is "gtd: building"
    And the file ".gtd/ARCHITECTURE.md" does not exist
    And the file ".gtd/01-parser/01-extract-parser.md" exists

  Scenario: A PLAN.md-entry cycle still reaches the human review gate (the review base anchors on the entry turn)
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      agenticReview: false
      squash: false
      learning: false
      """
    And a file ".gtd/PLAN.md" with:
      """
      # Plan

      Split the calculator into parser and evaluator modules.
      """
    And I run gtd step human
    And a file ".gtd/01-parser/01-extract-parser.md" with:
      """
      # Extract the parser

      - [ ] parser.ts exists
      """
    And I run gtd step agent
    And a file "parser.ts" with:
      """
      export const parse = (s: string) => s
      """
    When I run gtd step agent
    Then it succeeds
    # agenticReview is off: the green check force-approves and performs the
    # close INLINE — no marker commit is ever written.
    And the git log does not contain "gtd: tests-green"
    And the last commit subject is "gtd: close-package"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"review\""
    And stdout contains "\"actor\":\"agent\""

  Scenario: A dirty tree with a hand-written HEALTH.md enters directly at error fixing
    Given a test project
    And a file ".gtd/HEALTH.md" with:
      """
      The build breaks on Node 22 with ERR_REQUIRE_ESM in scripts/build.mjs.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): health-fixing"
    And the file ".gtd/HEALTH.md" exists
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    When I run gtd next
    Then it succeeds
    And stdout contains "ERR_REQUIRE_ESM"

  Scenario: The loop protocol's opening clean step-agent is inert at the HEALTH.md entry — the hand-written description survives unread
    Given a test project
    And a file ".gtd/HEALTH.md" with:
      """
      The build breaks on Node 22 with ERR_REQUIRE_ESM in scripts/build.mjs.
      """
    And I run gtd step human
    And I record the commit count
    When I run gtd step agent
    Then it succeeds
    And the commit count is unchanged
    And the file ".gtd/HEALTH.md" exists
    And the file ".gtd/HEALTH.md" contains "ERR_REQUIRE_ESM"
    When I run gtd next
    Then it succeeds
    And stdout contains "ERR_REQUIRE_ESM"

  Scenario: A HEALTH.md-entry fix that goes green first try still chains into the squash template
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      squash: true
      learning: false
      """
    And a file ".gtd/HEALTH.md" with:
      """
      scripts/build.mjs crashes on startup.
      """
    And I run gtd step human
    And a file "scripts/build.mjs" with:
      """
      export const fixed = true
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(human): health-fixing"
    And the git log contains "gtd(agent): health-fixing"
    And the git log contains "gtd: testing"
    And the git log contains "gtd: tests-green"
    And the git log contains "gtd: squashing"
    And the file ".gtd/HEALTH.md" does not exist
    And the file ".gtd/SQUASH_MSG.md" exists

  Scenario: A HEALTH.md-entry fix that stays red re-enters the normal health-check loop
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo SENTINEL_STILL_RED
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a file ".gtd/HEALTH.md" with:
      """
      Something is broken in gate.sh.
      """
    And I run gtd step human
    And a file "attempt.ts" with:
      """
      export const attempt = 1
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): health-fixing"
    And the git log contains "gtd: testing"
    And the last commit subject is "gtd: health-check"
    And the file ".gtd/HEALTH.md" exists
    And the file ".gtd/HEALTH.md" contains "SENTINEL_STILL_RED"

  Scenario: gtd status predicts the PLAN.md and HEALTH.md entry turns
    Given a test project
    And a file ".gtd/PLAN.md" with:
      """
      # Plan

      Split the calculator into parser and evaluator modules.
      """
    When I run gtd status with "--json"
    Then it succeeds
    And stdout contains "\"predictedCommit\":\"gtd(human): grilled\""

  Scenario: gtd status predicts the HEALTH.md entry turn
    Given a test project
    And a file ".gtd/HEALTH.md" with:
      """
      The build is broken.
      """
    When I run gtd status with "--json"
    Then it succeeds
    And stdout contains "\"predictedCommit\":\"gtd(human): health-fixing\""

  Scenario: PLAN.md next to TODO.md is an illegal combination — the entry refuses to guess
    Given a test project
    And a file ".gtd/PLAN.md" with:
      """
      # Plan
      """
    And a file ".gtd/TODO.md" with:
      """
      # Todo
      """
    When I run gtd step human
    Then it fails
    And stderr contains "illegal combination: .gtd/PLAN.md + .gtd/TODO.md"

  Scenario: PLAN.md next to ARCHITECTURE.md is an illegal combination
    Given a test project
    And a file ".gtd/PLAN.md" with:
      """
      # Plan
      """
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture
      """
    When I run gtd step human
    Then it fails
    And stderr contains "illegal combination: .gtd/PLAN.md + .gtd/ARCHITECTURE.md"

  Scenario: A hand-written HEALTH.md next to TODO.md is an illegal combination
    Given a test project
    And a file ".gtd/HEALTH.md" with:
      """
      The build is broken.
      """
    And a file ".gtd/TODO.md" with:
      """
      # Todo
      """
    When I run gtd step human
    Then it fails
    And stderr contains "illegal combination: .gtd/HEALTH.md + .gtd/TODO.md"
