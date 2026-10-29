@inmem
Feature: Command surface — bare gtd, unknown subcommands, --help, --version

  gtd exposes `land` (with `--cost=<n>`/`--model=<name>`), `start`,
  `abandon`, `restore`, `next`, `validate`, `check <mode> <file>`,
  `uncheck <file>`, `lsp`, `version`, and `help` among its subcommands.
  Bare `gtd` (no subcommand) is a usage error. `--help`/`help` and `--version`/`version`
  short-circuit before any repo-state work and exit 0 everywhere, including
  outside a workflow state.

  Scenario: Bare gtd fails with usage help on stderr and authors nothing
    Given a test project
    And I record the commit count
    When I run gtd
    Then it fails
    And stdout is empty
    And stderr contains "Usage:"
    And the commit count is unchanged

  Scenario: An unknown subcommand fails
    Given a test project
    When I run gtd with args "bogus-subcommand"
    Then it fails

  Scenario: The removed `init` subcommand is now unknown, exit 2
    Given a test project
    When I run gtd with args "init"
    Then the exit code is 2
    And stderr contains "unknown command 'init'"

  Scenario: The removed `run` subcommand is now unknown
    Given a test project
    When I run gtd with args "run"
    Then it fails

  Scenario: --help prints the command list
    Given a test project
    When I run gtd with "--help"
    Then it succeeds
    And stdout contains "land"
    And stdout contains "start [name] [args...]"
    And stdout does not contain "--workflow"
    And stdout contains "abandon"
    And stdout contains "next"
    And stdout contains "check <mode> <file>"
    And stdout contains "uncheck <file>"
    And stdout contains "base "

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
    And stdout contains "land"

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

  Scenario Outline: --json is a usage error on a command that prints neither a document nor a script
    Given a test project
    When I run gtd with args "<args>"
    Then it fails
    And stderr contains "only valid for `gtd next`/`gtd land`"
    And stderr contains "gtd guide"

    Examples:
      | args                     |
      | lsp --json               |
      | check qa TODO.md --json  |
      | uncheck REVIEW.md --json |
      | guide --json             |
      | summary --json           |
      | base --json              |

  Scenario: gtd next --sh is now an unrecognized flag, exit 2
    Given a test project
    When I run gtd with args "next --sh"
    Then it fails
    And stderr contains "unknown option"

  Scenario: gtd land --sh is now an unrecognized flag, exit 2
    Given a test project
    When I run gtd with args "land --sh"
    Then it fails
    And stderr contains "unknown option"

  Scenario: gtd start version refuses as an unknown name and prints no version
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
      }
      """
    When I run gtd with args "start version"
    Then the exit code is 2
    And stdout is empty
    And stderr contains "no workflow or door is named \"version\""

  Scenario: a usage error under --json writes the envelope on stderr, leaving stdout byte-empty
    Given a test project
    When I run gtd with args "bogus-subcommand --json"
    Then it fails
    And stdout is empty
    And stderr contains "\"state\":\"error\""
    And stderr matches "gtd: [^\n]*\n$"

  Scenario: gtd uncheck resets a review-mode file's ticked boxes back to unticked
    Given a test project
    And a file "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk

      - [x] ./src/calc.ts#1
      """
    When I run gtd with args "uncheck REVIEW.md"
    Then it succeeds
    And stdout is empty
    And "REVIEW.md" contains "- [ ] ./src/calc.ts#1"
    And "REVIEW.md" does not contain "- [x]"

  Scenario: gtd uncheck on a missing file writes nothing and exits 0
    Given a test project
    When I run gtd with args "uncheck REVIEW.md"
    Then it succeeds
    And stdout is empty

  Scenario: gtd uncheck with no file argument is a usage error, exit 2
    Given a test project
    When I run gtd with args "uncheck"
    Then it fails
    And stderr contains "missing file argument"

  Scenario: gtd uncheck takes no <mode> argument — a second positional is too many arguments
    Given a test project
    And a file "REVIEW.md" with:
      """
      # Review: abc1234
      """
    When I run gtd with args "uncheck review REVIEW.md"
    Then it fails
    And stderr contains "too many arguments"

  @inmem
  Scenario: bare gtd history is a usage error naming its subcommands
    Given a test project
    When I run gtd with args "history"
    Then the exit code is 2
    And stderr contains "list"
    And stderr contains "show"
    And stderr contains "fetch"
