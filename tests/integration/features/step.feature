@inmem
Feature: gtd step human — the human mutator

  `gtd step human` advances the machine to fixpoint: it authors the turn commit for
  the awaited human gate (plus any routing chain), then stops. It is
  idempotent — re-running at a fixpoint authors zero commits. Turns are
  strictly actor-separated: while an agent turn is awaited, `gtd step human` refuses
  (exit non-zero, zero commits) on clean and dirty trees alike — the mirror of
  `gtd step agent`'s refusal while a human turn is awaited. At idle it runs
  the health check: green exits 0 with zero commits, red writes and commits
  HEALTH.md as `gtd: health-check`.

  Scenario: A dirty tree at a boundary HEAD authors gtd(human): grilling and stops
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/sub.ts" with:
      """
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    And stdout contains "state: grilling"

  Scenario: A second gtd step human right after the entry turn is refused out-of-turn with zero new commits
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/sub.ts" with:
      """
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd step human
    Then it succeeds
    Then I record the commit count
    # The entry turn handed the machine to the agent (grilling awaits the
    # agent's questions). Strict turn separation: the human's step now errors
    # instead of no-op-ing — and still authors nothing.
    When I run gtd step human
    Then it fails
    And stderr contains "awaits an agent turn"
    And the commit count is unchanged

  Scenario: An empty human turn at the grilling answer gate accepts and advances to gtd: architecting
    Given a test project
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      <!-- user answers here -->
      """
    And a commit "gtd(agent): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator with add and subtract.

      no open questions — run gtd to plan
      """
    When I run gtd step human
    Then it succeeds
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      gtd(human): grilling
      gtd(agent): grilling
      gtd(human): grilling-accepted
      gtd: architecting
      """
    And the file ".gtd/TODO.md" does not exist
    And the file ".gtd/ARCHITECTURE.md" exists

  Scenario: Human step at the grilled rest is refused — the decompose window belongs to the agent
    Given a test project
    And a commit "gtd(human): architecting" that adds ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Build a calculator with add and subtract.
      """
    And a commit "gtd: grilled"
    And a file ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    Then I record the commit count
    # The dirty .gtd/ files are the decompose agent's own uncommitted output.
    # A human step here must not adopt them as gtd(human): grilled (which has
    # no route and would regress to grilling) — it is refused outright; the
    # human amends by leaving notes in .gtd package files AFTER the agent's
    # planning commit lands.
    When I run gtd step human
    Then it fails
    And stderr contains "run `gtd step agent`"
    And the commit count is unchanged
    And the file ".gtd/ARCHITECTURE.md" exists
    # The agent step is the only legal move: it commits the decomposition and
    # removes ARCHITECTURE.md in one chain.
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd: building"
    And the file ".gtd/ARCHITECTURE.md" does not exist

  Scenario: Out-of-turn human step while the agent is awaited is refused on a clean tree
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    Then I record the commit count
    When I run gtd step human
    Then it fails
    And stderr contains "awaits an agent turn"
    And the commit count is unchanged

  Scenario: Out-of-turn human step while the agent is awaited is refused on a dirty tree
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    And a file ".gtd/01-add/02-notes.md" with:
      """
      Also handle negative numbers.
      """
    Then I record the commit count
    # Turns are strictly separated: the human's pending notes are NOT adopted
    # as a human turn — they stay in the working tree and ride along as input
    # to the agent's next captured turn.
    When I run gtd step human
    Then it fails
    And stderr contains "awaits an agent turn"
    And the commit count is unchanged
    And the file ".gtd/01-add/02-notes.md" exists

  Scenario: Idle with a green health check exits 0 with zero commits
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      """
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    Then I record the commit count
    When I run gtd step human
    Then it succeeds
    And the commit count is unchanged
