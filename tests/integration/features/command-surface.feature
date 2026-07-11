@inmem
Feature: Command surface — bare gtd, unknown subcommands, --help, --version

  gtd v2 exposes `step`, `step-agent`, `next`, `status`, `format`, and `review`
  as its subcommands. Bare `gtd` (no subcommand) is a usage error. `--help` and
  `--version` short-circuit before any repo-state work and exit 0 everywhere,
  including outside a workflow state.

  Scenario: Bare gtd fails with usage help and authors nothing
    Given a test project
    And I record the commit count
    When I run gtd
    Then it fails
    And stdout contains "Usage:"
    And the commit count is unchanged

  Scenario: An unknown subcommand fails
    Given a test project
    When I run gtd with args "bogus-subcommand"
    Then it fails

  Scenario: --help prints the v2 command list
    Given a test project
    When I run gtd with "--help"
    Then it succeeds
    And stdout contains "step-agent"
    And stdout contains "next"

  Scenario: --version prints the version and exits 0
    Given a test project
    When I run gtd with "--version"
    Then it succeeds
    And stdout contains "2."

  Scenario: --help exits 0 outside any workflow state
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with "--help"
    Then it succeeds
    And stdout contains "Usage:"

  Scenario: --version exits 0 outside any workflow state
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with "--version"
    Then it succeeds
    And stdout contains "2."
