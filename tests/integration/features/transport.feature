Feature: Transport — mixed-reset a hand-made gtd: transport HEAD, then re-derive

  `gtd: transport` is the primitive for carrying uncommitted work across
  machines/branches: the user hand-commits `git add -A && git commit -m
  "gtd: transport"`, pushes, and on the far side gtd consumes it. Transport is
  precedence 0: it mixed-resets that HEAD (keeping the work in the tree) and
  re-derives state from scratch in the same run.

  Scenario: A gtd: transport HEAD is reset and the carried work re-derives
    Given a test project
    And a commit "gtd: transport" that adds "src/wip.ts" with:
      """
      export const wip = () => "carried across machines"
      """
    When I run gtd
    Then it succeeds
    # The transport commit is gone (mixed-reset); the carried work re-derived as a
    # fresh feature seed and advanced into grilling.
    And the git log does not contain "gtd: transport"
    And the git log contains "gtd: new task"
    And the last commit subject is "gtd: grilling"
    And stdout contains "## Task: Grill the plan in `TODO.md`"

  Scenario: A gtd: transport HEAD that is the repo root commit fails clearly
    Given a root commit "gtd: transport" that adds "src/wip.ts" with:
      """
      export const wip = () => "carried across machines"
      """
    When I run gtd
    Then it fails
    And stderr contains "root commit"
