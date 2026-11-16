@inmem
Feature: auto-clean removes integrated worktrees

  With `clean: { every }`, gtd runs a clean pass at each interval. A pass
  first refreshes each project's main checkout through the worktrees
  adapter; a stale main checkout shows a banner and sends a `mainStale`
  notification. Then it removes each worktree that the adapter reports as
  integrated (`true`, never unknown) and that nothing protects: a dirty tree,
  a process that has not ended, a running driver, a busy pane, a starting
  item, an error note or the main checkout. A removal stops the services,
  closes the idle panes, removes the worktree, ends its item, writes the
  audit log and delivers a `cleaned` change to the reactions. A project with
  `clean: false` is left alone. Scenarios run the supervisor in-process with
  the twins.

  Background:
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"], clean: { every: "30m" } })
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | login  |

  Scenario: a clean pass refreshes the main checkout, then removes an integrated worktree
    Given a commit lands on "portal/login"
    And "portal/login" is merged into main
    And a driver that an earlier supervisor started runs in "portal/login"
    And the driver in "portal/login" exits 0
    When I start gtd workspace
    And the clock advances "29m"
    Then gtd made no adapter calls
    When the clock advances "1m"
    Then gtd made these adapter calls:
      | call              | worktree     |
      | worktrees.refresh | portal       |
      | services.down     | portal/login |
      | terminal.close    | portal/login |
      | worktrees.remove  | portal/login |
    And the Projects view lists:
      | project | worktree | status | label |
      | portal  | main     | idle   | Idle  |
    And the audit log reads:
      | time                     | identity | endpoint | project | worktree | action | outcome  |
      | 2026-01-01T00:30:00.000Z | -        | clean    | portal  | login    | clean  | accepted |

  Scenario Outline: a worktree is removed only when the adapter says it is integrated
    Given a commit lands on "portal/login"
    And the worktrees adapter reports "portal/login" as integrated: <integrated>
    When I start gtd workspace
    And the clock advances "30m"
    Then gtd made these adapter calls:
      | call              | worktree |
      | worktrees.refresh | portal   |

    Examples:
      | integrated |
      | false      |
      | unknown    |

  Scenario: the main checkout is never removed, even when the adapter says it is integrated
    Given the worktrees adapter reports "portal/main" as integrated: true
    When I start gtd workspace
    And the clock advances "30m"
    Then gtd made these adapter calls:
      | call              | worktree |
      | worktrees.refresh | portal   |

  Scenario: an integrated worktree with uncommitted changes stays
    Given a commit lands on "portal/login"
    And "portal/login" is merged into main
    And "portal/login" has uncommitted changes
    When I start gtd workspace
    And the clock advances "30m"
    Then gtd made these adapter calls:
      | call              | worktree |
      | worktrees.refresh | portal   |

  Scenario: an integrated worktree whose process has not ended stays
    Given a commit lands on "portal/login"
    And "portal/login" is merged into main
    And gtd next --json in "portal/login" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    When I start gtd workspace
    And the clock advances "30m"
    Then gtd made these adapter calls:
      | call              | worktree |
      | worktrees.refresh | portal   |

  Scenario: an integrated worktree whose driver runs stays
    Given a commit lands on "portal/login"
    And "portal/login" is merged into main
    And a driver that an earlier supervisor started runs in "portal/login"
    When I start gtd workspace
    And the clock advances "30m"
    Then gtd made these adapter calls:
      | call              | worktree |
      | worktrees.refresh | portal   |

  Scenario: an integrated worktree with a busy pane stays
    Given a commit lands on "portal/login"
    And "portal/login" is merged into main
    And a driver that an earlier supervisor started runs in "portal/login"
    And the driver in "portal/login" exits 0
    And a person runs a command in the driver pane of "portal/login"
    When I start gtd workspace
    And the clock advances "30m"
    Then gtd made these adapter calls:
      | call              | worktree |
      | worktrees.refresh | portal   |

  Scenario: an integrated worktree with an error note stays
    Given a commit lands on "portal/login"
    And "portal/login" is merged into main
    When I start gtd workspace
    And I run "gtd workspace note portal.wt/login 'deploy failed' --error" in the workspace
    And the clock advances "30m"
    Then gtd made these adapter calls:
      | call              | worktree |
      | worktrees.refresh | portal   |

  Scenario: a worktree where an item is starting stays
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"], clean: { every: "30m" } })

      export const board = feed({
        project: "portal",
        every: "1h",
        mode: "propose",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list"])).stdout),
      })
      """
    And the actions adapter offers these actions:
      """
      [{ "id": "start:feature", "label": "Start a feature", "status": "idle", "fields": [] }]
      """
    And the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And the worktrees adapter reports "portal/board/7" as integrated: true
    And the clock advances "30m"
    Then gtd made these adapter calls:
      | call              | worktree       |
      | worktrees.create  | portal/board/7 |
      | services.up       | portal/board/7 |
      | worktrees.refresh | portal         |
    And the Inbox lists:
      | feed  | key | title      | state    |
      | board | 7   | Add signup | starting |

  Scenario: a cleaned worktree ends its item
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"], clean: { every: "30m" } })

      export const board = feed({
        project: "portal",
        every: "1h",
        mode: "propose",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list"])).stdout),
      })
      """
    And the actions adapter offers these actions:
      """
      [{ "id": "start:feature", "label": "Start a feature", "status": "idle", "fields": [] }]
      """
    And the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And the action in "portal/board/7" exits 0
    And the driver in "portal/board/7" exits 0
    And the worktrees adapter reports "portal/board/7" as integrated: true
    And the clock advances "30m"
    Then the Projects view lists:
      | project | worktree | status | label |
      | portal  | main     | idle   | Idle  |
      | portal  | login    | idle   | Idle  |
    When the clock advances "30m"
    Then the Inbox lists:
      | feed  | key | title      | state    |
      | board | 7   | Add signup | proposed |

  Scenario: a project with clean: false is left alone
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({
        driver: ["drive"],
        clean: { every: "30m" },
        projects: { portal: { clean: false } },
      })
      """
    And a commit lands on "portal/login"
    And "portal/login" is merged into main
    When I start gtd workspace
    And the clock advances "30m"
    Then gtd made no adapter calls

  Scenario: without clean, no pass runs
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })
      """
    And a commit lands on "portal/login"
    And "portal/login" is merged into main
    When I start gtd workspace
    And the clock advances "1h"
    Then gtd made no adapter calls

  Scenario: a stale main checkout shows a banner, marks its project and sends a mainStale notification
    Given a commit lands on "portal/login"
    And "portal/login" is merged into main
    And the main checkout of "portal" does not refresh:
      """
      git fetch failed: could not resolve host
      """
    When I start gtd workspace
    And the clock advances "30m"
    Then the dashboard shows the banner:
      """
      portal: the main checkout is stale: git fetch failed: could not resolve host
      """
    And gtd sent these notifications:
      | key              | title                               | body                                     | link | priority |
      | mainStale:portal | portal: the main checkout is stale | git fetch failed: could not resolve host | /    | default  |
    And the Projects view marks the main checkout of "portal" stale with:
      """
      git fetch failed: could not resolve host
      """
    And the Projects view lists:
      | project | worktree | status | label |
      | portal  | main     | idle   | Idle  |
    When the main checkout of "portal" refreshes again
    And the clock advances "30m"
    Then the dashboard shows no banner
    And the Projects view marks the main checkout of "portal" stale with:
      """
      """

  Scenario: a cleaned worktree is a cleaned change for the reactions
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, reaction } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"], clean: { every: "30m" } })

      export const cleaned = reaction({
        on: { to: "cleaned" },
        run: (change, ctx) => ctx.log(`${change.project}/${change.branch}: ${change.from} -> ${change.to}`),
      })
      """
    And a commit lands on "portal/login"
    And "portal/login" is merged into main
    When I start gtd workspace
    And the clock advances "30m"
    Then the reactions logged:
      """
      reaction cleaned: portal/login: idle -> cleaned
      """

  Scenario: a reload that sets clean starts the passes
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })
      """
    And a commit lands on "portal/login"
    And "portal/login" is merged into main
    When I start gtd workspace
    And the workspace file "gtd.workspace.ts" changes to:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"], clean: { every: "10m" } })
      """
    And the clock advances "10m"
    Then gtd made these adapter calls:
      | call              | worktree     |
      | worktrees.refresh | portal       |
      | services.down     | portal/login |
      | worktrees.remove  | portal/login |
