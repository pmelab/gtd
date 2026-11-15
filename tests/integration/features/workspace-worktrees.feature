@inmem
Feature: the dashboard creates and removes worktrees

  New worktree checks the branch name, asks the worktrees adapter to create
  the worktree, then starts its services. Remove stops the worktree's
  services, closes its idle panes, then asks the worktrees adapter to remove
  it, and returns once it is gone. Remove keeps a worktree that something
  still uses, and asks for confirmation before it throws away uncommitted
  changes or commits that are not on the default branch. Each change gets one
  line in the audit log. Scenarios run the supervisor in-process with the
  worktrees, services and terminal twins.

  Background:
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | login  |

  Scenario Outline: New worktree refuses a branch name git does not take, or one in use
    When I start gtd workspace
    And I create the worktree "<branch>" in "portal"
    Then gtd refuses the worktree change with:
      """
      <message>
      """
    And gtd made no adapter calls

    Examples:
      | branch      | message                                              |
      |             | the branch name is empty                             |
      | two words   | a branch name has no spaces or control characters    |
      | -x          | a branch name does not start with "-"                |
      | a..b        | a branch name has no ".."                            |
      | feat/       | a branch name does not end with "/"                  |
      | fix.lock    | a branch name does not end with ".lock"              |
      | a:b         | a branch name has none of ~ ^ : ? * [ \\             |
      | .hidden     | no part of a branch name starts with "."             |
      | login       | portal has a worktree on login already               |

  Scenario: New worktree creates the worktree, then starts its services
    When I start gtd workspace
    And I create the worktree "signup" in "portal"
    Then gtd made these adapter calls:
      | call             | worktree      |
      | worktrees.create | portal/signup |
      | services.up      | portal/signup |
    And the Projects view lists:
      | project | worktree | status | label |
      | portal  | main     | idle   | Idle  |
      | portal  | login    | idle   | Idle  |
      | portal  | signup   | idle   | Idle  |
    And the audit log reads:
      | time                     | identity          | endpoint     | project | worktree | action | outcome  |
      | 2026-01-01T00:00:00.000Z | owner@example.com | /trpc/createWorktree | portal  | signup | create | accepted |

  Scenario: Remove stops the services, closes the idle panes, then removes the worktree
    Given a commit lands on "portal/login"
    And "portal/login" is merged into main
    And a driver that an earlier supervisor started runs in "portal/login"
    And the driver in "portal/login" exits 0
    When I start gtd workspace
    And I remove "portal/login"
    Then gtd made these adapter calls:
      | call             | worktree     |
      | services.down    | portal/login |
      | terminal.close   | portal/login |
      | worktrees.remove | portal/login |
    And the Projects view lists:
      | project | worktree | status | label |
      | portal  | main     | idle   | Idle  |
    And the audit log reads:
      | time                     | identity          | endpoint     | project | worktree | action | outcome  |
      | 2026-01-01T00:00:00.000Z | owner@example.com | /trpc/removeWorktree | portal  | login | remove | accepted |

  Scenario: Remove keeps the main checkout
    When I start gtd workspace
    And I remove "portal/main"
    Then gtd refuses the worktree change with:
      """
      gtd keeps portal/main: it is the main checkout
      """
    And gtd made no adapter calls

  Scenario: Remove keeps a worktree whose process has not ended
    Given gtd next --json in "portal/login" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    When I start gtd workspace
    And I remove "portal/login" and confirm
    Then gtd refuses the worktree change with:
      """
      gtd keeps portal/login: its process has not ended
      """
    And gtd made no adapter calls

  Scenario: Remove keeps a worktree whose driver runs
    Given a driver that an earlier supervisor started runs in "portal/login"
    When I start gtd workspace
    And I remove "portal/login" and confirm
    Then gtd refuses the worktree change with:
      """
      gtd keeps portal/login: its driver runs
      """
    And gtd made no adapter calls

  Scenario: Remove keeps a worktree with a busy pane
    Given a driver that an earlier supervisor started runs in "portal/login"
    And the driver in "portal/login" exits 0
    And a person runs a command in the driver pane of "portal/login"
    When I start gtd workspace
    And I remove "portal/login" and confirm
    Then gtd refuses the worktree change with:
      """
      gtd keeps portal/login: a pane runs a command
      """
    And gtd made no adapter calls

  Scenario: Remove asks before it throws away uncommitted changes
    Given a commit lands on "portal/login"
    And "portal/login" is merged into main
    And "portal/login" has uncommitted changes
    When I start gtd workspace
    And I remove "portal/login"
    Then gtd asks to confirm:
      """
      the tree has uncommitted changes
      """
    And gtd made no adapter calls
    When I remove "portal/login" and confirm
    Then gtd made these adapter calls:
      | call                     | worktree     |
      | services.down            | portal/login |
      | worktrees.remove (force) | portal/login |
    And the Projects view does not list "portal/login"

  Scenario: Remove asks before it throws away commits that are not on the default branch
    Given a commit lands on "portal/login"
    When I start gtd workspace
    And I remove "portal/login"
    Then gtd asks to confirm:
      """
      the branch is not integrated
      """
    And gtd made no adapter calls
    When I remove "portal/login" and confirm
    Then gtd made these adapter calls:
      | call                     | worktree     |
      | services.down            | portal/login |
      | worktrees.remove (force) | portal/login |
    And the Projects view does not list "portal/login"
