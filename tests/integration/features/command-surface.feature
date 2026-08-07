@inmem
Feature: Command surface — bare gtd, unknown subcommands, --help, --version

  gtd v3 exposes `init`, `step <actor>` (with `--entry <state>`), `abandon`,
  `restore`, `next`, `status`, `validate`, `lsp`, `visualize`, `version`, and
  `help` as its subcommands. Bare `gtd` (no subcommand) is a usage error unless
  `--entry <state>` is given. `--help`/`help` and `--version`/`version`
  short-circuit before any repo-state work and exit 0 everywhere, including
  outside a workflow state.

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

  Scenario: The removed `run` subcommand is now unknown
    Given a test project
    When I run gtd with args "run"
    Then it fails

  Scenario: the removed `gtd review <commitish>` points at the --entry replacement
    Given a test project
    When I run gtd with args "review HEAD"
    Then it fails
    And stderr contains "gtd review <commitish>"
    And stderr contains "gone"
    And stderr contains "--entry"

  Scenario: the removed `gtd fix` points at the --entry replacement
    Given a test project
    When I run gtd with args "fix"
    Then it fails
    And stderr contains "gtd fix"
    And stderr contains "gone"
    And stderr contains "--entry"

  Scenario: --help prints the command list
    Given a test project
    When I run gtd with "--help"
    Then it succeeds
    And stdout contains "init "
    And stdout contains "step <actor>"
    And stdout contains "--entry <state>"
    And stdout contains "--var"
    And stdout contains "abandon"
    And stdout contains "next"
    And stdout contains "visualize"
    And stdout does not contain "review <commitish>"

  Scenario: --version prints the version and exits 0
    Given a test project
    When I run gtd with "--version"
    Then it succeeds
    And stdout matches "\d+\.\d+\.\d+"

  Scenario: the version subcommand prints the version and exits 0
    Given a test project
    When I run gtd with args "version"
    Then it succeeds
    And stdout matches "\d+\.\d+\.\d+"

  Scenario: the help subcommand prints the command list and exits 0
    Given a test project
    When I run gtd with args "help"
    Then it succeeds
    And stdout contains "step <actor>"

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
    And stdout matches "\d+\.\d+\.\d+"

  Scenario: --help lists the lsp subcommand
    Given a test project
    When I run gtd with "--help"
    Then it succeeds
    And stdout contains "lsp"

  Scenario: gtd lsp rejects --json — it's a long-running server, not a state command
    Given a test project
    When I run gtd with args "lsp --json"
    Then it fails
    And stderr contains "gtd lsp does not accept --json"
