@inmem
Feature: pause and resume dispatch

  `gtd workspace pause [<project> [<feed>]]` stops dispatch for the workspace,
  for one project, or for one feed of a project; `gtd workspace resume` with
  the same words starts it again. The dashboard's Inbox has the same controls.
  An item that a pause holds waits, queued, with the reason. A pause holds no
  driver that runs: with `--wait`, `pause` returns once no driver runs in that
  scope. The pauses stay when the supervisor restarts. Scenarios run the
  supervisor in-process with the twins; the actions twin's argv is the action
  id.

  Background:
    Given the actions adapter offers these actions:
      """
      [{ "id": "start:feature", "label": "Start a feature", "status": "idle", "fields": [] }]
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | login  |
      | api     | main   |
      | api     | search |
    And a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })

      export const bugs = feed({
        project: "portal",
        every: "5m",
        mode: "queue",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list", "bugs"])).stdout),
      })

      export const chores = feed({
        project: "portal",
        every: "5m",
        mode: "queue",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list", "chores"])).stdout),
      })

      export const board = feed({
        project: "api",
        every: "5m",
        mode: "queue",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list", "board"])).stdout),
      })
      """
    And the command "gh issue list bugs" prints:
      """
      []
      """
    And the command "gh issue list chores" prints:
      """
      []
      """
    And the command "gh issue list board" prints:
      """
      []
      """

  Scenario: a workspace pause holds every item until resume
    When I start gtd workspace
    And I run "gtd workspace pause" in the workspace
    Then the command exits 0
    Given the command "gh issue list bugs" prints:
      """
      [{ "key": "b1", "title": "Crash", "action": "start:feature", "priority": 0 }]
      """
    And the command "gh issue list board" prints:
      """
      [{ "key": "1", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When the clock advances "5m"
    Then gtd opened these action panes:
      | worktree | argv |
    And the Inbox lists:
      | feed  | key | state  | message                         |
      | board | 1   | queued | dispatch is paused in workspace |
      | bugs  | b1  | queued | dispatch is paused in workspace |
    And the Inbox reports these pauses:
      | project | feed |
      |         |      |
    When I run "gtd workspace resume" in the workspace
    Then the command exits 0
    And gtd opened these action panes:
      | worktree       | argv              |
      | api/board/1    | ["start:feature"] |
      | portal/bugs/b1 | ["start:feature"] |
    And the Inbox reports these pauses:
      | project | feed |
    And the audit log reads:
      | identity | endpoint | action | outcome  |
      | -        | cli      | pause  | accepted |
      | -        | cli      | resume | accepted |

  Scenario: a project pause holds that project's items, and the others start
    When I start gtd workspace
    And I run "gtd workspace pause portal" in the workspace
    Then the command exits 0
    Given the command "gh issue list bugs" prints:
      """
      [{ "key": "b1", "title": "Crash", "action": "start:feature", "priority": 0 }]
      """
    And the command "gh issue list board" prints:
      """
      [{ "key": "1", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When the clock advances "5m"
    Then gtd opened these action panes:
      | worktree    | argv              |
      | api/board/1 | ["start:feature"] |
    And the Inbox lists:
      | feed  | key | state    | message                      |
      | board | 1   | starting |                              |
      | bugs  | b1  | queued   | dispatch is paused in portal |
    When I run "gtd workspace resume portal" in the workspace
    Then gtd opened these action panes:
      | worktree       | argv              |
      | api/board/1    | ["start:feature"] |
      | portal/bugs/b1 | ["start:feature"] |

  Scenario: a feed pause holds that feed's items, and the project's other feeds start
    When I start gtd workspace
    And I run "gtd workspace pause portal bugs" in the workspace
    Then the command exits 0
    Given the command "gh issue list bugs" prints:
      """
      [{ "key": "b1", "title": "Crash", "action": "start:feature", "priority": 0 }]
      """
    And the command "gh issue list chores" prints:
      """
      [{ "key": "c1", "title": "Tidy up", "action": "start:feature", "priority": 0 }]
      """
    When the clock advances "5m"
    Then gtd opened these action panes:
      | worktree         | argv              |
      | portal/chores/c1 | ["start:feature"] |
    And the Inbox lists:
      | feed   | key | state    | message                              |
      | bugs   | b1  | queued   | dispatch is paused for the feed bugs |
      | chores | c1  | starting |                                      |
    And the Inbox reports these pauses:
      | project | feed |
      | portal  | bugs |

  Scenario: a pause holds an item a person started
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })

      export const board = feed({
        project: "api",
        every: "5m",
        mode: "propose",
        poll: async () => [{ key: "1", title: "Add signup", action: "start:feature", priority: 0 }],
      })
      """
    When I start gtd workspace
    And I run "gtd workspace pause api board" in the workspace
    And I start "board/1" in the Inbox
    Then gtd opened these action panes:
      | worktree | argv |
    And the Inbox lists:
      | feed  | key | state  | message                               |
      | board | 1   | queued | dispatch is paused for the feed board |

  Scenario: the pauses stay when the supervisor restarts
    When I start gtd workspace
    And I run "gtd workspace pause api" in the workspace
    And I stop gtd workspace
    And I start gtd workspace
    Then the Inbox reports these pauses:
      | project | feed |
      | api     |      |

  Scenario: the dashboard pauses and resumes dispatch
    When I start gtd workspace
    And I pause dispatch of "portal" in the Inbox
    And I pause dispatch of "api/board" in the Inbox
    Then the Inbox reports these pauses:
      | project | feed  |
      | api     | board |
      | portal  |       |
    When I resume dispatch of "portal" in the Inbox
    Then the Inbox reports these pauses:
      | project | feed  |
      | api     | board |
    And the audit log reads:
      | identity          | endpoint     | project | action | outcome  |
      | owner@example.com | /trpc/pause  | portal  | pause  | accepted |
      | owner@example.com | /trpc/pause  | api     | pause  | accepted |
      | owner@example.com | /trpc/resume | portal  | resume | accepted |

  Scenario: pause --wait returns once no driver runs in the project
    Given a driver that an earlier supervisor started runs in "portal/login"
    And a driver that an earlier supervisor started runs in "api/search"
    When I start gtd workspace
    And I run "gtd workspace pause portal --wait" in the workspace without waiting for it
    Then the command still runs
    When the driver in "portal/login" exits 0
    And 1 second passes
    Then the command exits 0
    And the driver in "api/search" still runs

  Scenario: pause --wait returns at once when no driver runs in the feed's worktrees
    Given a driver that an earlier supervisor started runs in "portal/login"
    When I start gtd workspace
    And I run "gtd workspace pause portal chores --wait" in the workspace
    Then the command exits 0

  Scenario: pause --wait waits for the drivers of the feed's items
    Given the command "gh issue list chores" prints:
      """
      [{ "key": "c1", "title": "Tidy up", "action": "start:feature", "priority": 0 }]
      """
    And a driver that an earlier supervisor started runs in "portal/login"
    When I start gtd workspace
    And the action in "portal/chores/c1" exits 0
    And I run "gtd workspace pause portal chores --wait" in the workspace without waiting for it
    Then the command still runs
    When the driver in "portal/chores/c1" exits 0
    And 1 second passes
    Then the command exits 0

  Scenario: an unknown project or feed exits 1
    When I start gtd workspace
    And I run "gtd workspace pause shop" in the workspace
    Then the command exits 1, printing:
      """
      gtd workspace pause: no project shop
      """
    When I run "gtd workspace resume portal board" in the workspace
    Then the command exits 1, printing:
      """
      gtd workspace resume: no feed board in portal
      """

  Scenario: pause and resume exit 1 when no supervisor runs
    When I run "gtd workspace pause" in the workspace
    Then the command exits 1, printing:
      """
      gtd workspace pause: supervisor not running for
      """
    When I run "gtd workspace resume portal" in the workspace
    Then the command exits 1, printing:
      """
      gtd workspace resume: supervisor not running for
      """

  Scenario: a pause of a feed that left the config can still be resumed
    When I start gtd workspace
    And I run "gtd workspace pause api board" in the workspace
    And the workspace file "gtd.workspace.ts" changes to:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })
      """
    And I run "gtd workspace resume api board" in the workspace
    Then the command exits 0
    And the Inbox reports these pauses:
      | project | feed |
