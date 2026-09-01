@inmem
Feature: Command surface — bare gtd, unknown subcommands, --help, --version

  gtd v3 exposes `init`, `land` (with `--cost=<n>`/`--model=<name>`),
  `abandon`, `restore`, `next`, `validate`, `check <mode> <file>`,
  `uncheck <file>`, `lsp`, `visualize`, `version`, and `help` as its
  subcommands. `--entry
  <state>` is only the bare form (no command at all) — landing and entering
  are different verbs. Bare `gtd` (no subcommand) is a usage error unless
  `--entry <state>` is given. `--help`/`help` and `--version`/`version`
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
    And stdout contains "land"
    And stdout contains "--entry <state>"
    And stdout contains "--var"
    And stdout contains "abandon"
    And stdout contains "next"
    And stdout contains "visualize"
    And stdout contains "check <mode> <file>"
    And stdout contains "--open-questions"
    And stdout contains "uncheck <file>"
    And stdout contains "base "
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

  Scenario Outline: --json is a usage error on every command except gtd next/gtd land — the only structured surfaces
    Given a test project
    When I run gtd with args "<args>"
    Then it fails
    And stderr contains "only valid for `gtd next`/`gtd land`"
    And stderr contains "gtd install"

    Examples:
      | args                    |
      | lsp --json              |
      | validate --json          |
      | check qa TODO.md --json  |
      | uncheck REVIEW.md --json |
      | init --json              |
      | visualize --json         |
      | install --json           |
      | abandon --json           |
      | restore --json           |
      | --entry idle --json      |

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

  Scenario: gtd --entry version refuses as an unknown entry state and prints no version
    # The regression this RFC exists to fix: a flag-unaware positional
    # extractor used to read "version" as `--entry`'s VALUE and the whole
    # invocation as a bare `gtd --version`-equivalent, printing the version.
    # The table-driven tokenizer now hands "version" to `--entry` as an
    # ordinary (unknown) state name instead.
    Given a test project
    When I run gtd with args "--entry version"
    Then it fails
    And stderr contains "is not an enterable state"

  Scenario: a usage error under --json writes the envelope on stderr, leaving stdout byte-empty
    Given a test project
    When I run gtd with args "bogus-subcommand --json"
    Then it fails
    And stdout is empty
    And stderr contains "\"state\":\"error\""
    And stderr matches "gtd: [^\n]*\n$"

  Scenario: gtd --entry --json fails with --entry requires a value
    Given a test project
    When I run gtd with args "--entry --json"
    Then it fails
    And stderr contains "--entry requires a value"

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
