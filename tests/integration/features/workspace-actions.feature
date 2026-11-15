@inmem
Feature: gtd workspace offers actions for the worktree status and runs them in panes of their own

  The actions adapter only describes actions: which worktree status each one
  is for, and its fields. The action picker offers the actions for the
  worktree's status now. gtd checks the values against the fields, asks the
  adapter for the argv, and runs it through the terminal adapter in a new
  pane, never the driver's, with `GTD_WORKSPACE_STATUS` set. A start action
  (one for idle) that exits 0 starts the driver. Scenarios run the supervisor
  in-process with the actions and terminal twins; the actions twin's argv is
  the action id, then `--<field>` or `--<field>=<value>` for each value.

  Background:
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })
      """
    And the actions adapter offers these actions:
      """
      [
        {
          "id": "start:work",
          "label": "Start work",
          "status": "idle",
          "fields": [
            { "name": "title", "type": "text", "required": true },
            { "name": "mode", "type": "select", "required": false, "choices": ["fast", "slow"] },
            { "name": "dry", "type": "flag", "required": false }
          ]
        },
        { "id": "gate:approve", "label": "Approve", "status": "needsYou", "fields": [] },
        {
          "id": "error:fix",
          "label": "Try a fix",
          "status": "error",
          "fields": [{ "name": "hint", "type": "text", "required": false }]
        },
        { "id": "any:shell", "label": "Open a shell", "status": "any", "fields": [] }
      ]
      """

  Scenario: the action picker offers only the actions for the worktree status
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | plan   |
      | portal  | build  |
      | portal  | stuck  |
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And gtd next --json in "portal/build" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    And gtd next --json in "portal/stuck" prints:
      """
      { "kind": "stalled", "actor": "human", "idle": false, "label": "Tests", "content": "the check failed 3 times" }
      """
    And a driver that an earlier supervisor started runs in "portal/build"
    When I start gtd workspace
    Then the action picker of "portal/main" offers:
      | status | action     | fields            |
      | idle   | start:work | title, mode, dry  |
      | idle   | any:shell  |                   |
    And the action picker of "portal/plan" offers:
      | status   | action       | fields |
      | needsYou | gate:approve |        |
      | needsYou | any:shell    |        |
    And the action picker of "portal/stuck" offers:
      | status | action    | fields |
      | error  | error:fix | hint   |
      | error  | any:shell |        |
    And the action picker of "portal/build" offers:
      | status  | action    | fields |
      | working | any:shell |        |

  Scenario: an action runs in a pane of its own and gets the worktree status
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | broke  |
    And gtd next --json in "portal/broke" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    And a driver that an earlier supervisor started runs in "portal/broke"
    And the driver in "portal/broke" reports:
      """
      { "state": "error", "msg": "the API key is missing" }
      """
    When I start gtd workspace
    And I run the action "error:fix" in "portal/broke" with:
      """
      { "hint": "it's $HOME; `id` | x" }
      """
    Then gtd opened these action panes:
      | worktree     | argv                                         |
      | portal/broke | ["error:fix","--hint=it's $HOME; `id` \| x"] |
    And the action in "portal/broke" got GTD_WORKSPACE_STATUS:
      """
      { "status": "error", "errorKind": "driver", "message": "the API key is missing", "commit": "<HEAD>" }
      """
    And the driver in "portal/broke" still runs
    And the Projects view shows these last actions:
      | worktree     | action    | exit    |
      | portal/broke | error:fix | running |

  Scenario: a start action that exits 0 starts the driver
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | fresh  |
    When I start gtd workspace
    And I run the action "start:work" in "portal/fresh" with:
      """
      { "title": "Add a login page", "mode": "fast", "dry": true }
      """
    Then gtd opened these action panes:
      | worktree     | argv                                                           |
      | portal/fresh | ["start:work","--title=Add a login page","--mode=fast","--dry"] |
    And the action in "portal/fresh" got GTD_WORKSPACE_STATUS:
      """
      { "status": "idle", "commit": "<HEAD>" }
      """
    And gtd opened these driver panes:
      | worktree | argv |
    When the action in "portal/fresh" exits 0
    Then gtd opened these driver panes:
      | worktree     | argv  |
      | portal/fresh | drive |

  Scenario: a start action that fails starts no driver and shows on the worktree
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | fresh  |
    When I start gtd workspace
    And I run the action "start:work" in "portal/fresh" with:
      """
      { "title": "Add a login page" }
      """
    And the action in "portal/fresh" exits 2
    Then gtd opened these driver panes:
      | worktree | argv |
    And the Projects view shows these last actions:
      | worktree     | action     | exit |
      | portal/fresh | start:work | 2    |

  Scenario: an action that does not fit the status or its fields is refused before it runs
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
    When I start gtd workspace
    And I run the action "gate:approve" in "portal/main"
    Then gtd refuses the action with:
      """
      gate:approve is not offered while the worktree is idle
      """
    When I run the action "start:work" in "portal/main"
    Then gtd refuses the action with:
      """
      title is required
      """
    When I run the action "start:work" in "portal/main" with:
      """
      { "title": "t", "mode": "reckless" }
      """
    Then gtd refuses the action with:
      """
      mode must be one of fast, slow
      """
    When I run the action "start:work" in "portal/main" with:
      """
      { "title": "t", "force": true }
      """
    Then gtd refuses the action with:
      """
      no field force
      """
    And gtd opened these action panes:
      | worktree | argv |
