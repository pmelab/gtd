@inmem
Feature: gtd review <target> subcommand

  `gtd review <target>` resolves the merge-base between the target ref and HEAD,
  diffs HEAD against that base (excluding workflow files), commits an empty
  `gtd: reviewing` anchor, and emits the Clean review prompt. It is an
  alternative entry point that bypasses the auto-detect review rules — useful for
  ad-hoc reviews on any branch, without a `gtd: grilling` marker present.

  Scenario: Review against a branch tip emits the Clean prompt and the gtd: reviewing anchor
    Given a test project
    And a default branch "main"
    And a commit "chore: base setup" that adds "src/base.ts" with:
      """
      export const base = () => "base"
      """
    And a branch "feature"
    And a commit "feat: add widget" that adds "src/widget.ts" with:
      """
      export const widget = () => "widget"
      """
    When I run gtd with args "review main"
    Then it succeeds
    And stdout contains "help a human to review the changes"
    And stdout contains "src/widget.ts"
    And stdout does not contain "src/base.ts"
    And the last commit subject is "gtd: reviewing"

  Scenario: No target argument exits 1 with a clear error
    Given a test project
    When I run gtd with args "review"
    Then it fails
    And stderr contains "missing target argument"

  Scenario: Too many arguments exits 1 with a clear error
    Given a test project
    When I run gtd with args "review a b"
    Then it fails
    And stderr contains "too many arguments"

  Scenario: Unresolvable ref exits 1 and mentions the bad ref
    Given a test project
    When I run gtd with args "review no-such-branch"
    Then it fails
    And stderr contains "no-such-branch"

  Scenario: Empty diff (target equals HEAD tip) exits 1 and leaves no gtd: reviewing commit
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: add greeter" that adds "src/greet.ts" with:
      """
      export const greet = (name: string) => `Hello, ${name}`
      """
    When I run gtd with args "review feature"
    Then it fails
    And stderr contains "nothing to review"
    And the git log does not contain "gtd: reviewing"

  Scenario: --json flag emits a JSON envelope with autoAdvance true and writes the gtd: reviewing anchor
    Given a test project
    And a default branch "main"
    And a commit "chore: initial lib" that adds "src/lib.ts" with:
      """
      export const lib = () => "lib"
      """
    And a branch "feature"
    And a commit "feat: add helper" that adds "src/helper.ts" with:
      """
      export const helper = () => "helper"
      """
    When I run gtd with args "review main --json"
    Then it succeeds
    And stdout contains "\"state\""
    And stdout contains "\"autoAdvance\":true"
    And stdout contains "\"prompt\""
    And the last commit subject is "gtd: reviewing"

  Scenario: Squash collapses back to the gtd: reviewing anchor with no surviving gtd: awaiting review or gtd: done
    Given a test project
    And a default branch "main"
    And a commit "chore: scaffold" that adds "src/app.ts" with:
      """
      export const app = () => "app"
      """
    And a branch "feature"
    And a gtd config file at ".gtdrc" with:
      """
      squash: true
      """
    When I run gtd with args "review main"
    Then it succeeds
    And the last commit subject is "gtd: reviewing"
    And a commit "feat: add parser" that adds "src/parser.ts" with:
      """
      export const parse = (s: string) => JSON.parse(s)
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      - ./src/parser.ts#1
      """
    And a commit "gtd: done" that deletes "REVIEW.md"
    And a file "SQUASH_MSG.md" with content:
      """
      feat(parser): add JSON parser
      """
    When I run gtd
    Then it succeeds
    And the HEAD commit subject is "feat(parser): add JSON parser"
    And the git log does not contain "gtd: reviewing"
    And the git log does not contain "gtd: awaiting review"
    And the git log does not contain "gtd: done"
    And "src/parser.ts" exists
