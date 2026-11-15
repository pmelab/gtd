@inmem
Feature: gtd workspace keeps worktree statuses current

  The supervisor keeps the last snapshot of every worktree. The worktrees
  adapter's watch hints that a project may have changed; the supervisor waits
  a moment for more hints, then rechecks that project: it lists the project
  again and runs `gtd next` in each worktree whose HEAD moved. A project has
  one recheck at a time. Every 30 seconds a rescan runs `gtd next` in every
  worktree, which catches an uncommitted edit. An adapter without a watch is
  read every `pollEvery`. When a watch stream ends, the supervisor watches
  again and reads a full snapshot. Scenarios run on a clock the test moves.

  Background:
    Given a workspace file "gtd.workspace.ts" with:
      """
      export const workspace = {}
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | plan   |
      | api     | main   |
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """

  Scenario: commits in quick succession recheck the project once, after a short wait
    When I start gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the review" }
      """
    And a commit lands on "portal/plan"
    And 0.2 seconds pass
    And a commit lands on "portal/plan"
    And 0.2 seconds pass
    And a commit lands on "portal/plan"
    Then the Projects view shows "portal/plan" as "needsYou" with "Answer the plan"
    When 0.2 seconds pass
    Then the Projects view shows "portal/plan" as "needsYou" with "Answer the review"
    And gtd next has run 2 times in "portal/plan"
    And gtd next has run 1 time in "api/main"

  Scenario: a project has one recheck at a time
    When I start gtd workspace
    And gtd next in "portal/plan" holds its answer
    And a commit lands on "portal/plan"
    And 1 second passes
    And a commit lands on "portal/plan"
    And 1 second passes
    Then gtd next has run 2 times in "portal/plan"
    When gtd next in "portal/plan" gives its answer
    Then gtd next has run 3 times in "portal/plan"
    And gtd next never ran twice at once in "portal/plan"

  Scenario: the rescan every 30 seconds finds an uncommitted edit
    When I start gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the edited plan" }
      """
    And 29 seconds pass
    Then the Projects view shows "portal/plan" as "needsYou" with "Answer the plan"
    When 1 second passes
    Then the Projects view shows "portal/plan" as "needsYou" with "Answer the edited plan"
    And gtd next has run 2 times in "api/main"

  Scenario: an adapter without a watch is read every pollEvery
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ pollEvery: "5s" })
      """
    And the worktrees adapter has no watch
    When I start gtd workspace
    And the worktrees adapter adds the worktree "portal/build"
    And 4 seconds pass
    Then the Projects view does not list "portal/build"
    When 1 second passes
    Then the Projects view shows "portal/build" as "idle" with "Idle"
    And gtd next has run 1 time in "portal/plan"

  Scenario: after a watch stream ends, the supervisor watches again and reads a full snapshot
    When I start gtd workspace
    And the worktrees adapter's watch stream ends
    And the worktrees adapter adds the worktree "portal/build"
    And 1 second passes
    Then the worktrees adapter has been watched 2 times
    And the Projects view shows "portal/build" as "idle" with "Idle"

  Scenario: a failed read keeps the last snapshot, greyed, under a banner
    When I start gtd workspace
    And the worktrees adapter fails to list "portal" with:
      """
      wt list failed
      """
    And a commit lands on "portal/plan"
    And 1 second passes
    Then the dashboard shows the banner:
      """
      worktrees unavailable: wt list failed
      """
    And the dashboard page reads:
      """
      Projects
      worktrees unavailable: wt list failed
      api
      idle main Idle
      portal
      worktrees unavailable: wt list failed
      idle main Idle worktrees unavailable
      needs you plan Answer the plan worktrees unavailable
      """
    When the worktrees adapter answers again
    And a commit lands on "portal/plan"
    And 1 second passes
    Then the dashboard shows no banner
    And the Projects view greys no worktree
