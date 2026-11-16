@inmem
Feature: gtd workspace reloads gtd.workspace.ts

  An edit of gtd.workspace.ts reloads it while the supervisor runs. A reload
  that fails keeps the last good config and shows a banner; the next good
  reload clears it. Settings per project are keyed by the worktrees adapter's
  project id, and a `projects` entry that names no project shows a banner.

  Background:
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |

  Scenario: a bad reload keeps the last good config under a banner, and a good one clears it
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ projects: { portal: { name: "Portal" } } })
      """
    When I start gtd workspace
    And the workspace file "gtd.workspace.ts" changes to:
      """
      export const workspace = { projects: { portal: { title: "Web" } } }
      """
    Then the dashboard shows the banner:
      """
      gtd.workspace.ts not reloaded: workspace.projects.portal.title: is not a known key
      """
    And the Projects view lists:
      | project | worktree | status | label |
      | Portal  | main     | idle   | Idle  |
    When the workspace file "gtd.workspace.ts" changes to:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ projects: { portal: { name: "Web" } } })
      """
    Then the dashboard shows no banner
    And the Projects view lists:
      | project | worktree | status | label |
      | Web     | main     | idle   | Idle  |

  Scenario: a reload that cannot evaluate the file keeps the last good config
    Given a workspace file "gtd.workspace.ts" with:
      """
      export const workspace = {}
      """
    When I start gtd workspace
    And the workspace file "gtd.workspace.ts" changes to:
      """
      throw new Error("half-written")
      """
    Then the dashboard shows the banner:
      """
      gtd.workspace.ts not reloaded: half-written
      """

  Scenario: a reload schedules the feeds it now exports
    Given a workspace file "gtd.workspace.ts" with:
      """
      export const workspace = {}
      """
    And the command "gh issue list" prints:
      """
      [{ "number": 1, "title": "Add login" }]
      """
    When I start gtd workspace
    And the workspace file "gtd.workspace.ts" changes to:
      """
      import { feed } from "@pmelab/gtd/workspace"

      export const issues = feed({
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
    Then the Inbox lists:
      | feed   | key | title     | state    |
      | issues | 1   | Add login | proposed |

  Scenario: a poll that a reload overtakes files nothing, and the new feed polls at once
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })

      export const board = feed({
        project: "portal",
        every: "5m",
        mode: "queue",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list"])).stdout),
      })
      """
    And the command "gh issue list" prints:
      """
      [{ "key": "7", "title": "Add signup", "action": "start:feature", "priority": 0 }]
      """
    And the command "gh issue list --label ready" prints:
      """
      [{ "key": "8", "title": "Add search", "action": "start:feature", "priority": 0 }]
      """
    And the command "gh issue list" holds its answer
    When I start gtd workspace
    And the workspace file "gtd.workspace.ts" changes to:
      """
      import { defineWorkspace, feed } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })

      export const board = feed({
        project: "portal",
        every: "5m",
        mode: "propose",
        poll: async (ctx) =>
          JSON.parse((await ctx.exec(["gh", "issue", "list", "--label", "ready"])).stdout),
      })
      """
    And the command "gh issue list" gives its answer
    Then the Inbox lists:
      | feed  | key | title      | state    |
      | board | 8   | Add search | proposed |

  Scenario: a project setting that names no project shows a banner
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ projects: { portl: { name: "Portal" } } })
      """
    When I start gtd workspace
    Then the dashboard shows the banner:
      """
      gtd.workspace.ts: workspace.projects.portl: no project has this id
      """
    And the Projects view lists:
      | project | worktree | status | label |
      | portal  | main     | idle   | Idle  |
