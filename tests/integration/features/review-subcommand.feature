@inmem
Feature: gtd review <target> subcommand — anchor-then-exit

  `gtd review <target>` is a pure mutator: it refuses on a dirty tree, resolves
  the target via merge-base semantics, refuses when the filtered diff against
  that base is empty ("nothing to review"), and otherwise authors exactly one
  anchor commit `gtd: review <base-hash>`. It never emits a prompt itself —
  stdout only points at `gtd next` — and exits 0. A follow-up `gtd next` is
  what emits the review-record prompt (actor agent), scoped to that anchor.

  Scenario: A clean repo anchors the review and exits without a prompt
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
    And the git log contains "gtd: review "
    And stdout contains "gtd next"
    And stdout does not contain "\"prompt\""
    And stdout does not contain "## Task"

  Scenario: A follow-up gtd next emits the review-record prompt scoped to the anchor
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
    And I run gtd with args "review main"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "src/widget.ts"
    And stdout does not contain "src/base.ts"

  Scenario: A dirty tree refuses the review with zero commits
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
    And a file "src/dirty.ts" with:
      """
      export const dirty = () => "dirty"
      """
    And I record the commit count
    When I run gtd with args "review main"
    Then it fails
    And the commit count is unchanged

  Scenario: Empty diff against the target refuses with "nothing to review"
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: add greeter" that adds "src/greet.ts" with:
      """
      export const greet = (name: string) => `Hello, ${name}`
      """
    And I record the commit count
    When I run gtd with args "review feature"
    Then it fails
    And stderr contains "nothing to review"
    And the commit count is unchanged
    And the git log does not contain "gtd: review "

  Scenario: An unresolvable ref fails and names the bad ref
    Given a test project
    When I run gtd with args "review no-such-branch"
    Then it fails
    And stderr contains "no-such-branch"
