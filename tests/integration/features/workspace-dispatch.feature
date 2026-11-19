@inmem
Feature: Start and Retry dispatch an inbox item

  Start on a proposed item, and Retry on a failed one, dispatch it: gtd
  creates the item's worktree, or uses the free existing worktree of the
  item's `branch`, starts its services, runs the item's start action in a
  pane of its own, and starts the driver when the action exits 0. The action
  and the driver get the item as `GTD_WORKSPACE_ITEM`. An item without a
  `branch` starts on the branch `<feed>/<key>`. A worktree is free when its
  process has ended, no driver runs and the tree is clean; otherwise the item
  waits, and gtd tries again after the next poll. Scenarios run the
  supervisor in-process with the worktrees, services, actions and terminal
  twins; the actions twin's argv is the action id.

  Background:
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })

      export const board = feed({
        project: "portal",
        every: "5m",
        mode: "propose",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list"])).stdout),
      })
      """
    And the actions adapter offers these actions:
      """
      [{ "id": "start:feature", "label": "Start a feature", "status": "idle", "fields": [] }]
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | login  |

  Scenario: Start creates the item's worktree, runs its start action, then the driver
    Given the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "url": "https://example.com/7", "action": "start:feature", "priority": 1, "data": { "ship": "pr" } }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    Then gtd made these adapter calls:
      | call             | worktree      |
      | worktrees.create | portal/board/7 |
      | services.up      | portal/board/7 |
    And gtd opened these action panes:
      | worktree       | argv              |
      | portal/board/7 | ["start:feature"] |
    And the action in "portal/board/7" got GTD_WORKSPACE_ITEM:
      """
      { "key": "7", "title": "Add signup", "url": "https://example.com/7", "action": "start:feature", "priority": 1, "blockedBy": [], "data": { "ship": "pr" }, "feed": "board", "project": "portal" }
      """
    And the Inbox lists:
      | feed  | key | title      | state    |
      | board | 7   | Add signup | starting |
    When I remove "portal/board/7" and confirm
    Then gtd refuses the worktree change with:
      """
      gtd keeps portal/board/7: a pane runs a command, an item is starting in it
      """
    When the action in "portal/board/7" exits 0
    Then gtd opened these driver panes:
      | worktree       | argv  |
      | portal/board/7 | drive |
    And the driver in "portal/board/7" got GTD_WORKSPACE_ITEM:
      """
      { "key": "7", "title": "Add signup", "url": "https://example.com/7", "action": "start:feature", "priority": 1, "blockedBy": [], "data": { "ship": "pr" }, "feed": "board", "project": "portal" }
      """
    And the Inbox lists:
      | feed | key | title | state |
    And the audit log reads:
      | time                     | identity          | endpoint        | project | worktree | action    | outcome  |
      | 2026-01-01T00:00:00.000Z | owner@example.com | /trpc/startItem | portal  | board/7  | startItem | accepted |

  Scenario: a started item ends when its worktree is removed
    Given the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And the action in "portal/board/7" exits 0
    And the clock advances "5m"
    Then the Inbox lists:
      | feed | key | title | state |
    When the driver in "portal/board/7" exits 0
    And I remove "portal/board/7" and confirm
    And the clock advances "5m"
    Then the Inbox lists:
      | feed  | key | title      | state    |
      | board | 7   | Add signup | proposed |
    And the Projects view lists:
      | project | worktree | status | label |
      | portal  | main     | idle   | Idle  |
      | portal  | login    | idle   | Idle  |

  Scenario: an item with a branch starts in that free worktree
    Given the command "gh issue list" prints:
      """
      [{ "key": "pr-12", "title": "Review login", "action": "start:feature", "priority": 0, "branch": "login" }]
      """
    When I start gtd workspace
    And I start "board/pr-12" in the Inbox
    Then gtd made these adapter calls:
      | call        | worktree     |
      | services.up | portal/login |
    And gtd opened these action panes:
      | worktree     | argv              |
      | portal/login | ["start:feature"] |

  Scenario: an item whose branch worktree is busy waits until it is free
    Given the command "gh issue list" prints:
      """
      [{ "key": "pr-12", "title": "Review login", "action": "start:feature", "priority": 0, "branch": "login" }]
      """
    And gtd next --json in "portal/login" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    And a driver that an earlier supervisor started runs in "portal/login"
    And "portal/login" has uncommitted changes
    When I start gtd workspace
    And I start "board/pr-12" in the Inbox
    Then the Inbox lists:
      | feed  | key   | title        | state  | message                                                                                          |
      | board | pr-12 | Review login | queued | portal/login is not free: its process has not ended, its driver runs, the tree has uncommitted changes |
    And gtd made no adapter calls
    Given gtd next --json in "portal/login" prints:
      """
      { "kind": "capture", "actor": "human", "idle": true, "label": "Idle" }
      """
    And the driver in "portal/login" exits 0
    And "portal/login" has no uncommitted changes
    When the clock advances "5m"
    Then gtd opened these action panes:
      | worktree     | argv              |
      | portal/login | ["start:feature"] |
    And the Inbox lists:
      | feed  | key   | title        | state    |
      | board | pr-12 | Review login | starting |

  Scenario: a failed item stays until Retry, which starts it again in its worktree
    Given the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And the action in "portal/board/7" exits 2
    Then the Inbox lists:
      | feed  | key | title      | state  | message                   |
      | board | 7   | Add signup | failed | start:feature exited 2 (worktree {root}/portal.wt/board/7) |
    And gtd opened these driver panes:
      | worktree | argv |
    Given the command "gh issue list" prints:
      """
      []
      """
    When the clock advances "5m"
    And I stop gtd workspace
    And I start gtd workspace
    Then the Inbox lists:
      | feed  | key | title      | state  |
      | board | 7   | Add signup | failed |
    When I retry "board/7" in the Inbox
    Then gtd opened these action panes:
      | worktree       | argv              |
      | portal/board/7 | ["start:feature"] |
      | portal/board/7 | ["start:feature"] |
    When the action in "portal/board/7" exits 0
    Then gtd opened these driver panes:
      | worktree       | argv  |
      | portal/board/7 | drive |

  Scenario: Retry reuses the worktree of a failed item, though its start action moved it to another branch
    Given the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And the worktree "portal/board/7" moves to the branch "pr-12"
    And the action in "portal/pr-12" exits 2
    And I retry "board/7" in the Inbox
    Then gtd made these adapter calls:
      | call             | worktree       |
      | worktrees.create | portal/board/7 |
      | services.up      | portal/board/7 |
      | services.up      | portal/pr-12   |
    And gtd opened these action panes:
      | worktree     | argv              |
      | portal/pr-12 | ["start:feature"] |
      | portal/pr-12 | ["start:feature"] |

  Scenario: Retry that waits for a limit runs the start action in the moved worktree
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"], limits: { wip: 1 } })

      export const board = feed({
        project: "portal",
        every: "5m",
        mode: "propose",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list"])).stdout),
      })
      """
    And the command "gh issue list" prints:
      """
      [
        { "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 },
        { "key": "8", "title": "Add footer", "action": "start:feature", "priority": 0 }
      ]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And the worktree "portal/board/7" moves to the branch "pr-12"
    And the action in "portal/pr-12" exits 2
    And I start "board/8" in the Inbox
    And I retry "board/7" in the Inbox
    And the action in "portal/board/8" exits 2
    And the clock advances "5m"
    Then gtd opened these action panes:
      | worktree       | argv              |
      | portal/pr-12   | ["start:feature"] |
      | portal/board/8 | ["start:feature"] |
      | portal/pr-12   | ["start:feature"] |

  Scenario: Retry creates a new worktree when the adapter has no unpushed
    Given the worktrees adapter has no unpushed
    And the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And the worktree "portal/board/7" moves to the branch "pr-12"
    And the action in "portal/pr-12" exits 2
    And I retry "board/7" in the Inbox
    Then gtd made these adapter calls:
      | call             | worktree       |
      | worktrees.create | portal/board/7 |
      | services.up      | portal/board/7 |
      | worktrees.create | portal/board/7 |
      | services.up      | portal/board/7 |

  Scenario: Retry after a restart reuses the worktree the failed dispatch used
    Given the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And the worktree "portal/board/7" moves to the branch "pr-12"
    And the action in "portal/pr-12" exits 2
    And I stop gtd workspace
    And I start gtd workspace
    And I retry "board/7" in the Inbox
    Then gtd made these adapter calls:
      | call             | worktree       |
      | worktrees.create | portal/board/7 |
      | services.up      | portal/board/7 |
      | services.up      | portal/pr-12   |

  Scenario: Retry creates a worktree on the leftover branch
    Given the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And the action in "portal/board/7" exits 2
    And the worktree "portal/board/7" is gone but its branch stays
    And I retry "board/7" in the Inbox
    Then gtd made these adapter calls:
      | call             | worktree       |
      | worktrees.create | portal/board/7 |
      | services.up      | portal/board/7 |
      | worktrees.switch | portal/board/7 |
      | services.up      | portal/board/7 |

  Scenario Outline: Retry refuses a leftover worktree that holds work
    Given the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And the action in "portal/board/7" exits 2
    And <work>
    And I retry "board/7" in the Inbox
    Then the Inbox lists:
      | feed  | key | title      | state  | message   |
      | board | 7   | Add signup | failed | <message> |
    And gtd opened these action panes:
      | worktree       | argv              |
      | portal/board/7 | ["start:feature"] |

    Examples:
      | work                                                   | message                                                                                               |
      | the tree of "portal/board/7" has uncommitted changes   | Retry refused, {root}/portal.wt/board/7 is not free: the tree has uncommitted changes |
      | "portal/board/7" has a commit that is on no remote     | Retry refused, {root}/portal.wt/board/7 is not free: it has commits outside the remotes |

  Scenario: Retry refuses a leftover branch that holds commits
    Given the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And the action in "portal/board/7" exits 2
    And "portal/board/7" has a commit that is on no remote
    And the worktree "portal/board/7" is gone but its branch stays
    And I retry "board/7" in the Inbox
    Then the Inbox lists:
      | feed  | key | title      | state  | message                                                               |
      | board | 7   | Add signup | failed | Retry refused, branch board/7 is not free: it has commits outside the remotes |

  Scenario: a restarted supervisor follows the start action the last one left running
    Given the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And I stop gtd workspace
    And I start gtd workspace
    Then the Inbox lists:
      | feed  | key | title      | state    |
      | board | 7   | Add signup | starting |
    When I remove "portal/board/7" and confirm
    Then gtd refuses the worktree change with:
      """
      gtd keeps portal/board/7: a pane runs a command, an item is starting in it
      """
    When the action in "portal/board/7" exits 0
    Then gtd opened these driver panes:
      | worktree       | argv  |
      | portal/board/7 | drive |
    And the driver in "portal/board/7" got GTD_WORKSPACE_ITEM:
      """
      { "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0, "blockedBy": [], "data": null, "feed": "board", "project": "portal" }
      """
    And the Inbox lists:
      | feed | key | title | state |

  Scenario: an item whose start action is gone after a restart fails
    Given the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And I stop gtd workspace
    And the action pane of "portal/board/7" is gone
    And I start gtd workspace
    Then the Inbox lists:
      | feed  | key | title      | state  | message                            |
      | board | 7   | Add signup | failed | gtd stopped while the item started (worktree {root}/portal.wt/board/7) |

  Scenario: a start action gtd cannot run fails the item
    Given the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:bugfix", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    Then the Inbox lists:
      | feed  | key | title      | state  | message                                        |
      | board | 7   | Add signup | failed | start:bugfix is not offered while the worktree is idle (worktree {root}/portal.wt/board/7) |

  Scenario: a failed item can be dismissed
    Given the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:bugfix", "priority": 0 }]
      """
    When I start gtd workspace
    And I start "board/7" in the Inbox
    And I dismiss "board/7" in the Inbox
    Then the Inbox lists:
      | feed | key | title | state |

  Scenario: Start answers once its item is dispatched, while the other waiting items still dispatch
    Given the command "gh issue list" prints:
      """
      [
        { "key": "7", "title": "Add signup", "action": "start:feature", "priority": 1 },
        { "key": "8", "title": "Fix login", "action": "start:feature", "priority": 0, "branch": "login" }
      ]
      """
    And a driver that an earlier supervisor started runs in "portal/login"
    When I start gtd workspace
    And I start "board/8" in the Inbox
    And gtd next in "portal/login" holds its answer
    And I start "board/7" in the Inbox
    Then gtd opened these action panes:
      | worktree       | argv              |
      | portal/board/7 | ["start:feature"] |
    When gtd next in "portal/login" gives its answer
