@inmem
Feature: The stderr narration channel, and the -v/-V swap

  `--verbose`/`-v` gates one line of commentary per in-process fact a
  dispatch already computes — which rest resolved, how config resolved
  across layers. `-V` (not `-v`) is now `--version`'s short-circuit alias;
  `-v` alone no longer prints a version.

  Scenario: without --verbose, gtd status prints no narration to stderr
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        greeting: hi
      """
    When I run gtd status
    Then it succeeds
    And stderr does not contain "rest resolved:"
    And stderr does not contain "config: layer"

  Scenario: --verbose narrates the resolved rest and config layers on stderr, never stdout
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        greeting: hi
      """
    When I run gtd with args "status --verbose"
    Then it succeeds
    And stderr contains "rest resolved:"
    And stderr contains "config: layer"

  Scenario: -v is the alias for --verbose
    Given a test project
    When I run gtd with args "status -v"
    Then it succeeds
    And stderr contains "rest resolved:"

  Scenario: -V still short-circuits to the version output at exit 0
    Given a test project
    When I run gtd with "-V"
    Then it succeeds
    And stdout matches "\d+\.\d+\.\d+"

  Scenario: bare gtd -v no longer prints a version — it is the missing-command usage error
    Given a test project
    When I run gtd with "-v"
    Then it fails
    And stderr contains "missing command"

  Scenario: the rendered help shows --version, -V and --verbose, -v
    Given a test project
    When I run gtd with "--help"
    Then it succeeds
    And stdout contains "--version, -V"
    And stdout contains "--verbose"

  Scenario: --verbose narrates which declared pattern each pending change matched
    Given a test project
    And a file "NOTES.md" with:
      """
      a scratch note
      """
    When I run gtd with args "status --verbose"
    Then it succeeds
    And stderr contains "pending:"

  Scenario: --verbose narrates the review-window action a land emits
    Given a test project
    And the workflow
    And a commit "gtd(agent): building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And an empty commit "gtd(check): build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    When I run gtd with args "land --verbose"
    Then it succeeds
    And stderr contains "review-window: open"
