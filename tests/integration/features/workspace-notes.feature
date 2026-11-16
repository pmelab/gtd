@inmem
Feature: Notes on worktrees

  `gtd workspace note <worktree> <message> [--error]` puts a note on a
  worktree, and `gtd workspace note <worktree> --clear` takes it off again.
  Ship scripts use notes to show shipping, merge and deploy outcomes. An error
  note turns the worktree status into an error of kind `note`. When no
  supervisor runs, the note waits in the spool of the supervisor's state
  directory, and the supervisor applies it when it starts.

  Background:
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({})
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | login  |

  Scenario: a note shows on the worktree and keeps its status
    When I start gtd workspace
    And I run "gtd workspace note portal.wt/login 'merged into main'" in the workspace
    Then the command exits 0
    And the Projects view shows the note on "portal/login":
      """
      merged into main
      """
    And the Projects view lists:
      | project | worktree | status | label |
      | portal  | main     | idle   | Idle  |
      | portal  | login    | idle   | Idle  |
    And the audit log reads:
      | identity | endpoint | project | worktree | action | outcome  |
      | -        | cli      | portal  | login    | note   | accepted |

  Scenario: an error note turns the worktree status into an error of kind note
    When I start gtd workspace
    And I run "gtd workspace note portal.wt/login 'deploy failed' --error" in the workspace
    Then the command exits 0
    And the Projects view lists:
      | project | worktree | status       | label                |
      | portal  | main     | idle         | Idle                 |
      | portal  | login    | error (note) | Idle — deploy failed |

  Scenario: a worktree in error keeps its own error under an error note
    Given gtd next --json in "portal/login" prints:
      """
      { "kind": "stalled", "actor": "agent", "idle": false, "label": "Stalled" }
      """
    When I start gtd workspace
    And I run "gtd workspace note portal.wt/login 'deploy failed' --error" in the workspace
    Then the Projects view lists:
      | project | worktree | status          | label   |
      | portal  | main     | idle            | Idle    |
      | portal  | login    | error (stalled) | Stalled |

  Scenario: --clear takes the note off
    When I start gtd workspace
    And I run "gtd workspace note portal.wt/login 'deploy failed' --error" in the workspace
    And I run "gtd workspace note portal.wt/login --clear" in the workspace
    Then the command exits 0
    And the Projects view shows no note on "portal/login"
    And the Projects view lists:
      | project | worktree | status | label |
      | portal  | main     | idle   | Idle  |
      | portal  | login    | idle   | Idle  |

  Scenario: a note outlives the supervisor
    When I start gtd workspace
    And I run "gtd workspace note portal.wt/login 'deploy failed' --error" in the workspace
    And I stop gtd workspace
    And I start gtd workspace
    Then the Projects view shows the note on "portal/login":
      """
      deploy failed
      """

  Scenario: with no supervisor running, the note waits in the spool
    When I run "gtd workspace note portal.wt/login 'merged into main'" in the workspace
    And I run "gtd workspace note portal 'deploy failed' --error" in the workspace
    Then the command exits 0
    When I start gtd workspace
    Then the Projects view lists:
      | project | worktree | status       | label                |
      | portal  | main     | error (note) | Idle — deploy failed |
      | portal  | login    | idle         | Idle                 |
    And the Projects view shows the note on "portal/login":
      """
      merged into main
      """
    And the audit log reads:
      | identity | endpoint | project | worktree | action | outcome  |
      | -        | spool    | portal  | login    | note   | accepted |
      | -        | spool    | portal  | main     | note   | accepted |
    And the supervisor's spool is empty

  Scenario: spooled notes apply in the order they were written
    When I run "gtd workspace note portal.wt/login 'deploy failed' --error" in the workspace
    And I run "gtd workspace note portal.wt/login --clear" in the workspace
    And I start gtd workspace
    Then the Projects view shows no note on "portal/login"

  Scenario: a spooled note on a path that is no worktree is dropped
    When I run "gtd workspace note elsewhere done" in the workspace
    Then the command exits 0
    When I start gtd workspace
    Then the supervisor's spool is empty
    And the Projects view lists:
      | project | worktree | status | label |
      | portal  | main     | idle   | Idle  |
      | portal  | login    | idle   | Idle  |

  Scenario: a note on a path that is no worktree exits 1
    When I start gtd workspace
    And I run "gtd workspace note elsewhere done" in the workspace
    Then the command exits 1, printing:
      """
      gtd workspace note: no worktree at
      """

  Scenario Outline: note takes a message, or --clear alone
    When I run "gtd workspace note portal.wt/login <args>" in the workspace
    Then the command exits 2, printing:
      """
      <message>
      """

    Examples:
      | args            | message                                                    |
      | --error         | gtd workspace note: missing message argument               |
      | done --clear    | gtd workspace note: --clear takes no message               |
      | --clear --error | gtd workspace note: --clear and --error cannot be combined |
      | --clear --notify | gtd workspace note: --clear and --notify cannot be combined |

  Scenario: --error, --notify and --clear are only valid for note
    When I run "gtd workspace proceed portal.wt/login 0000 --notify" in the workspace
    Then the command exits 2, printing:
      """
      gtd: --error, --notify and --clear are only valid for `gtd workspace note`
      """
