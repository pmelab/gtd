@inmem
Feature: feeds file items into the workspace inbox

  A feed is a `feed()` export of gtd.workspace.ts. Each poll returns every
  item that matches now; gtd compares that with the inbox. Scenarios answer
  the feeds' `ctx.exec` from a table and move a controllable clock. A feed
  polls once when the supervisor starts, then once per `every`.

  Background:
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { feed } from "@pmelab/gtd/workspace"

      export const boardReady = feed({
        project: "portal",
        every: "5m",
        mode: "propose",
        poll: async (ctx) => {
          const out = await ctx.exec(["gh", "issue", "list"])
          return JSON.parse(out.stdout).map((i: { number: number; title: string }) => ({
            key: String(i.number),
            title: i.title,
            action: "start:feature",
            priority: 0,
          }))
        },
      })
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |

  Scenario: each poll adds new items, updates known ones and drops those no longer returned
    Given the command "gh issue list" prints:
      """
      [{ "number": 1, "title": "Add login" }, { "number": 2, "title": "Fix footer" }]
      """
    When I start gtd workspace
    Then the Inbox lists:
      | feed       | key | title      | state    |
      | boardReady | 1   | Add login  | proposed |
      | boardReady | 2   | Fix footer | proposed |
    Given the command "gh issue list" prints:
      """
      [{ "number": 2, "title": "Fix the footer" }, { "number": 3, "title": "Dark mode" }]
      """
    When the clock advances "4m"
    Then the Inbox lists:
      | feed       | key | title      | state    |
      | boardReady | 1   | Add login  | proposed |
      | boardReady | 2   | Fix footer | proposed |
    When the clock advances "1m"
    Then the Inbox lists:
      | feed       | key | title          | state    |
      | boardReady | 2   | Fix the footer | proposed |
      | boardReady | 3   | Dark mode      | proposed |

  Scenario: a dismissed item stays hidden until its feed stops returning it
    Given the command "gh issue list" prints:
      """
      [{ "number": 1, "title": "Add login" }, { "number": 2, "title": "Fix footer" }]
      """
    When I start gtd workspace
    And I dismiss "boardReady/1" in the Inbox
    And the clock advances "5m"
    Then the Inbox lists:
      | feed       | key | title      | state    |
      | boardReady | 2   | Fix footer | proposed |
    Given the command "gh issue list" prints:
      """
      [{ "number": 2, "title": "Fix footer" }]
      """
    When the clock advances "5m"
    And the command "gh issue list" prints:
      """
      [{ "number": 1, "title": "Add login again" }, { "number": 2, "title": "Fix footer" }]
      """
    And the clock advances "5m"
    Then the Inbox lists:
      | feed       | key | title           | state    |
      | boardReady | 1   | Add login again | proposed |
      | boardReady | 2   | Fix footer      | proposed |

  Scenario: a dismissal survives a restart in the state store outside the workspace
    Given the command "gh issue list" prints:
      """
      [{ "number": 1, "title": "Add login" }, { "number": 2, "title": "Fix footer" }]
      """
    When I start gtd workspace
    And I dismiss "boardReady/1" in the Inbox
    And I stop gtd workspace
    And I start gtd workspace
    Then the Inbox lists:
      | feed       | key | title      | state    |
      | boardReady | 2   | Fix footer | proposed |
    And the workspace directory holds only "gtd.workspace.ts"

  Scenario: deleting the state store brings dismissed items back and loses nothing else
    Given the command "gh issue list" prints:
      """
      [{ "number": 1, "title": "Add login" }]
      """
    When I start gtd workspace
    And I dismiss "boardReady/1" in the Inbox
    And I stop gtd workspace
    And I delete the supervisor's state directory
    And I start gtd workspace
    Then the Inbox lists:
      | feed       | key | title     | state    |
      | boardReady | 1   | Add login | proposed |

  Scenario: a feed whose poll throws is reported and the other feeds keep filing
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { feed } from "@pmelab/gtd/workspace"

      export const broken = feed({
        project: "portal",
        every: "1m",
        mode: "propose",
        poll: async () => {
          throw new Error("gh: not logged in")
        },
      })

      export const reviews = feed({
        project: "portal",
        every: "1m",
        mode: "queue",
        poll: async () => [
          { key: "pr-7", title: "Review #7", action: "start:review", priority: 1 },
          { key: "pr-8", title: "Review #8", action: "start:review", priority: 2, blockedBy: ["pr-7"] },
        ],
      })
      """
    When I start gtd workspace
    Then the Inbox lists:
      | feed    | key  | title     | state   |
      | reviews | pr-8 | Review #8 | blocked |
      | reviews | pr-7 | Review #7 | queued  |
    And the Inbox reports these feeds:
      | feed    | project | mode    | failing           |
      | broken  | portal  | propose | gh: not logged in |
      | reviews | portal  | queue   |                   |

  Scenario: a poll result that is not a list of items fails the feed and keeps its items
    Given the command "gh issue list" prints:
      """
      [{ "number": 1, "title": "Add login" }]
      """
    When I start gtd workspace
    And the command "gh issue list" prints:
      """
      [{ "number": 2 }]
      """
    And the clock advances "5m"
    Then the Inbox lists:
      | feed       | key | title     | state    |
      | boardReady | 1   | Add login | proposed |
    And the Inbox reports these feeds:
      | feed       | project | mode    | failing                    |
      | boardReady | portal  | propose | item 0: title: is required |

  Scenario: the Inbox page shows the waiting items
    Given the command "gh issue list" prints:
      """
      [{ "number": 1, "title": "Add login" }]
      """
    When I start gtd workspace
    Then the Inbox page reads:
      """
      Inbox
      proposed Add login boardReady · portal Dismiss
      """
