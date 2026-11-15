Feature: Proceed and Retry from the command line

  `gtd workspace proceed|retry <worktree> <commit>` presses Proceed or Retry
  as the dashboard does. It reaches the running supervisor over a unix socket
  in the supervisor's state directory; only the owner may open it. When no
  supervisor runs, the command exits 1. A step stands in for the driver's
  one-shots: they answer 0 while the driver's pane runs, else 2.

  Background:
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })
      """

  @live
  Scenario: the socket is the owner's alone, and gone when the supervisor ends
    When I send SIGTERM to a spawned gtd workspace, first running "gtd workspace proceed nowhere 0000"
    Then the supervisor's socket had the mode 0600 while it served
    And the command run beside the supervisor exited 1, printing:
      """
      no worktree at
      """
    And the reported exit status is 143
    And the supervisor's state directory holds no socket

  @inmem
  Scenario: proceed sends the commit to the worktree's driver
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | plan   |
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And a driver that an earlier supervisor started runs in "portal/plan"
    When I start gtd workspace
    And I run "gtd workspace proceed portal.wt/plan <HEAD of portal/plan>" in the workspace
    Then the command exits 0
    And the driver one-shots ran:
      | worktree    | argv                 |
      | portal/plan | drive proceed <HEAD> |
    And the audit log reads:
      | identity | endpoint | project | worktree | action  | outcome  |
      | -        | cli      | portal  | plan     | proceed | accepted |

  @inmem
  Scenario: retry sends the commit to the worktree's driver
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | build  |
    And gtd next --json in "portal/build" prints:
      """
      { "kind": "stalled", "actor": "agent", "idle": false, "label": "Stalled" }
      """
    And a driver that an earlier supervisor started runs in "portal/build"
    When I start gtd workspace
    And I run "gtd workspace retry portal.wt/build <HEAD of portal/build>" in the workspace
    Then the command exits 0
    And the driver one-shots ran:
      | worktree     | argv               |
      | portal/build | drive retry <HEAD> |

  @inmem
  Scenario: a refused press exits 1 with the reason
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | plan   |
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And a driver that an earlier supervisor started runs in "portal/plan"
    When I start gtd workspace
    And a commit lands on "portal/plan"
    And I run "gtd workspace proceed portal.wt/plan 0123456789abcdef0123456789abcdef01234567" in the workspace
    Then the command exits 1, printing:
      """
      gtd workspace proceed: HEAD moved since the page loaded; reload and look again
      """
    And the driver one-shots ran:
      | worktree | argv |

  @inmem
  Scenario: a path that is no worktree exits 1
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
    When I start gtd workspace
    And I run "gtd workspace retry elsewhere 0123456789abcdef0123456789abcdef01234567" in the workspace
    Then the command exits 1, printing:
      """
      gtd workspace retry: no worktree at
      """

  @inmem
  Scenario: with no supervisor running, the command exits 1
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
    When I run "gtd workspace proceed portal 0123456789abcdef0123456789abcdef01234567" in the workspace
    Then the command exits 1, printing:
      """
      gtd workspace proceed: supervisor not running
      """

  @inmem
  Scenario: a stopped supervisor is not running either
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
    When I start gtd workspace
    And I stop gtd workspace
    And I run "gtd workspace retry portal 0123456789abcdef0123456789abcdef01234567" in the workspace
    Then the command exits 1, printing:
      """
      gtd workspace retry: supervisor not running
      """

  @inmem
  Scenario: the worktree and the commit are both required
    When I run "gtd workspace proceed portal" in the workspace
    Then the command exits 2, printing:
      """
      gtd workspace proceed: missing commit argument
      """
