@live
Feature: gtd init — scaffold a .gtdrc.json from a bundled workflow template

  `gtd init <workflow>` (see src/program.ts) writes a `.gtdrc.json` carrying one
  of the bundled workflow templates inline (`simple` / `advanced`), so a repo
  picks a state machine explicitly — gtd ships no default, and a state command
  run with no workflow configured fails with a pointer back to `gtd init`.
  The written file is left UNCOMMITTED (the user reviews and commits it), and
  init refuses to clobber an existing config. Runs @live so the real
  config-detection (cosmiconfig over the real filesystem) is exercised.

  Scenario: gtd init simple writes an uncommitted .gtdrc.json with the simple workflow inline
    Given a test project
    When I run gtd with args "init simple"
    Then it succeeds
    And stdout contains "Wrote .gtdrc.json"
    And stdout contains "commit"
    And ".gtdrc.json" exists
    And ".gtdrc.json" contains "\"$schema\""
    And ".gtdrc.json" contains "\"workflow\""
    And ".gtdrc.json" contains "review-deciding"
    # Left uncommitted — HEAD is still the project's own initial commit.
    And the last commit subject is "chore: initial commit"

  Scenario: gtd init advanced writes the fuller machine (architecting, decompose, squash finale)
    Given a test project
    When I run gtd with args "init advanced"
    Then it succeeds
    And ".gtdrc.json" exists
    And ".gtdrc.json" contains "architecting"
    And ".gtdrc.json" contains "decompose"
    And ".gtdrc.json" contains "squashing"

  Scenario: gtd init with no workflow argument is a usage error listing the choices
    Given a test project
    When I run gtd with args "init"
    Then it fails
    And stderr contains "missing workflow"
    And stderr contains "simple"
    And stderr contains "advanced"
    And ".gtdrc.json" does not exist

  Scenario: gtd init rejects an unknown workflow name
    Given a test project
    When I run gtd with args "init bogus"
    Then it fails
    And stderr contains "unknown workflow 'bogus'"
    And ".gtdrc.json" does not exist

  Scenario: gtd init refuses to overwrite an existing gtd config
    Given a test project
    And the "simple" workflow
    When I run gtd with args "init advanced"
    Then it fails
    And stderr contains "already exists"

  Scenario: a state command with no workflow configured fails with the init hint
    Given a test project
    When I run gtd status
    Then it fails
    And stderr contains "no workflow configured"
    And stderr contains "gtd init"
