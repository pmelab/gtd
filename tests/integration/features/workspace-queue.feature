@inmem
Feature: queue feeds dispatch their items within the limits

  A `queue` feed's items dispatch without a person, like a started item. gtd
  dispatches waiting items in start order: priority, then poll order, then the
  time it first saw them. A drive is a worktree whose driver runs, or one an
  item is starting in. `limits.maxDrives` caps the drives in the workspace,
  `wip` (in `limits`, or per project) those in one project. At dispatch gtd
  checks again that its `blockedBy` is empty, and
  runs the feed's `canStart`. An item that cannot start waits, queued, with the
  reason, and gtd tries again after the next poll. Scenarios run the supervisor
  in-process with the twins; the actions twin's argv is the action id.

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

  Scenario: waiting items start in order: priority, then poll order, then the time first seen
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })

      const ready = async (ctx) => (await ctx.exec(["ready"])).status === 0

      export const bugs = feed({
        project: "portal",
        every: "5m",
        mode: "queue",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list", "bugs"])).stdout),
        canStart: (item, ctx) => ready(ctx),
      })

      export const chores = feed({
        project: "portal",
        every: "5m",
        mode: "queue",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list", "chores"])).stdout),
        canStart: (item, ctx) => ready(ctx),
      })
      """
    And the command "gh issue list bugs" prints:
      """
      []
      """
    And the command "gh issue list chores" prints:
      """
      [{ "key": "c1", "title": "Tidy up", "action": "start:feature", "priority": 0 }]
      """
    And the command "ready" exits 1
    When I start gtd workspace
    Then gtd opened these action panes:
      | worktree | argv |
    Given the command "gh issue list bugs" prints:
      """
      [
        { "key": "b1", "title": "Crash", "action": "start:feature", "priority": 0 },
        { "key": "b2", "title": "Typo", "action": "start:feature", "priority": 0 },
        { "key": "b3", "title": "Outage", "action": "start:feature", "priority": 5 }
      ]
      """
    And the command "ready" exits 0
    When the clock advances "5m"
    Then gtd opened these action panes:
      | worktree         | argv              |
      | portal/bugs/b3   | ["start:feature"] |
      | portal/chores/c1 | ["start:feature"] |
      | portal/bugs/b1   | ["start:feature"] |
      | portal/bugs/b2   | ["start:feature"] |

  Scenario: maxDrives holds items while that many drivers run in the workspace
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"], limits: { maxDrives: 2 } })

      export const board = feed({
        project: "api",
        every: "5m",
        mode: "queue",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list"])).stdout),
      })
      """
    And the command "gh issue list" prints:
      """
      [
        { "key": "1", "title": "Add signup", "action": "start:feature", "priority": 1 },
        { "key": "2", "title": "Add search", "action": "start:feature", "priority": 0 }
      ]
      """
    And a driver that an earlier supervisor started runs in "portal/login"
    When I start gtd workspace
    Then gtd opened these action panes:
      | worktree    | argv              |
      | api/board/1 | ["start:feature"] |
    And the Inbox lists:
      | feed  | key | title      | state    | message                                  |
      | board | 1   | Add signup | starting |                                          |
      | board | 2   | Add search | queued   | 2 of 2 drives in use (limits.maxDrives) |
    And the Inbox counts "2 of 2" drives in use
    When the driver in "portal/login" exits 0
    And the clock advances "5m"
    Then gtd opened these action panes:
      | worktree    | argv              |
      | api/board/1 | ["start:feature"] |
      | api/board/2 | ["start:feature"] |
    And the Inbox counts "2 of 2" drives in use

  Scenario: maxDrives counts the drivers that items started earlier in the same dispatch
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"], limits: { maxDrives: 2 } })

      export const board = feed({
        project: "api",
        every: "5m",
        mode: "queue",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list"])).stdout),
      })
      """
    And the command "gh issue list" prints:
      """
      [
        { "key": "1", "title": "Add signup", "action": "start:feature", "priority": 2 },
        { "key": "2", "title": "Add search", "action": "start:feature", "priority": 1 },
        { "key": "3", "title": "Add export", "action": "start:feature", "priority": 0 }
      ]
      """
    And the program "start:feature" exits 0 as soon as it starts
    When I start gtd workspace
    Then gtd opened these action panes:
      | worktree    | argv              |
      | api/board/1 | ["start:feature"] |
      | api/board/2 | ["start:feature"] |
    And the Inbox counts "2 of 2" drives in use

  Scenario: the Inbox counts drives from what gtd keeps, without asking the terminal
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"], limits: { maxDrives: 2 } })
      """
    And a driver that an earlier supervisor started runs in "portal/login"
    When I start gtd workspace
    And the terminal adapter stops answering
    Then the Inbox counts "1 of 2" drives in use

  Scenario: wip holds items while that many drivers run in the project
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({
        driver: ["drive"],
        limits: { wip: 1 },
        projects: { api: { wip: 2 } },
      })

      export const web = feed({
        project: "portal",
        every: "5m",
        mode: "queue",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list", "web"])).stdout),
      })

      export const backend = feed({
        project: "api",
        every: "5m",
        mode: "queue",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list", "api"])).stdout),
      })
      """
    And the command "gh issue list web" prints:
      """
      [
        { "key": "1", "title": "Add login", "action": "start:feature", "priority": 0 },
        { "key": "2", "title": "Add footer", "action": "start:feature", "priority": 0 }
      ]
      """
    And the command "gh issue list api" prints:
      """
      [
        { "key": "1", "title": "Add auth", "action": "start:feature", "priority": 0 },
        { "key": "2", "title": "Add cache", "action": "start:feature", "priority": 0 }
      ]
      """
    When I start gtd workspace
    Then gtd opened these action panes:
      | worktree      | argv              |
      | api/backend/1 | ["start:feature"] |
      | portal/web/1  | ["start:feature"] |
      | api/backend/2 | ["start:feature"] |
    And the Inbox lists:
      | feed    | key | title      | state    | message                                   |
      | backend | 1   | Add auth   | starting |                                           |
      | web     | 1   | Add login  | starting |                                           |
      | backend | 2   | Add cache  | starting |                                           |
      | web     | 2   | Add footer | queued   | portal: 1 of 1 drives in use (limits.wip) |
    And the Inbox counts "3" drives in use

  Scenario: an item waits while its feed lists a blocker in blockedBy, until a poll drops it
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })

      export const deploys = feed({
        project: "portal",
        every: "5m",
        mode: "queue",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "pr", "list"])).stdout),
      })

      // A slow feed: its first poll ends after the other feed's.
      export const board = feed({
        project: "portal",
        every: "5m",
        mode: "propose",
        poll: async (ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return JSON.parse((await ctx.exec(["gh", "issue", "list"])).stdout)
        },
      })
      """
    And the command "gh pr list" prints:
      """
      [{ "key": "d1", "title": "Deploy", "action": "start:feature", "priority": 0, "blockedBy": ["board/7"] }]
      """
    And the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Fix login", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    Then the Inbox lists:
      | feed    | key | title     | state    |
      | board   | 7   | Fix login | proposed |
      | deploys | d1  | Deploy    | blocked  |
    And gtd opened these action panes:
      | worktree | argv |
    Given the command "gh pr list" prints:
      """
      [{ "key": "d1", "title": "Deploy", "action": "start:feature", "priority": 0, "blockedBy": [] }]
      """
    When the clock advances "5m"
    Then gtd opened these action panes:
      | worktree           | argv              |
      | portal/deploys/d1  | ["start:feature"] |

  Scenario: canStart holds an item at dispatch, also one a person started
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })

      export const board = feed({
        project: "portal",
        every: "5m",
        mode: "propose",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list"])).stdout),
        canStart: async (item, ctx) => {
          const out = await ctx.exec(["ci", "status", item.key])
          if (out.status === 2) throw new Error("ci is down")
          return out.status === 0
        },
      })
      """
    And the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    And the command "ci status 7" exits 1
    When I start gtd workspace
    And I start "board/7" in the Inbox
    Then the Inbox lists:
      | feed  | key | title      | state  | message                         |
      | board | 7   | Add signup | queued | its feed's canStart holds it    |
    Given the command "ci status 7" exits 2
    When the clock advances "5m"
    Then the Inbox lists:
      | feed  | key | title      | state  | message                         |
      | board | 7   | Add signup | queued | its feed's canStart failed: ci is down |
    Given the command "ci status 7" exits 0
    When the clock advances "5m"
    Then gtd opened these action panes:
      | worktree       | argv              |
      | portal/board/7 | ["start:feature"] |

  Scenario: the waiting items of a feed the config no longer exports leave the Inbox
    Given a workspace file "gtd.workspace.ts" with:
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
        canStart: async (item, ctx) => (await ctx.exec(["ready"])).status === 0,
      })
      """
    And the command "gh issue list bugs" prints:
      """
      []
      """
    And the command "gh issue list chores" prints:
      """
      [{ "key": "c1", "title": "Tidy up", "action": "start:feature", "priority": 0 }]
      """
    And the command "ready" exits 1
    When I start gtd workspace
    And the workspace file "gtd.workspace.ts" changes to:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })

      export const bugs = feed({
        project: "portal",
        every: "5m",
        mode: "queue",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list", "bugs"])).stdout),
      })
      """
    And the clock advances "5m"
    Then gtd opened these action panes:
      | worktree | argv |
    And the Inbox lists:
      | feed | key | title | state |
