Feature: gtd workspace lists every worktree with its worktree status

  `gtd workspace` is the one supervisor of a workspace: it finds its
  gtd.workspace.ts, takes the workspace's lock, and serves the Projects view.
  Each worktree's status comes from `gtd next --json` run in that worktree.
  Scenarios run the supervisor in-process with the worktrees adapter's twin, a
  table of `gtd next` answers and the fake tailnet; a worktree without an
  answer reports a process that has ended. What only a real process shows, a
  signal's exit status, runs `@live`.

  @live
  Scenario: gtd workspace exits 143 on SIGTERM and frees the workspace
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({})
      """
    When I send SIGTERM to a spawned gtd workspace
    Then the reported exit status is 143
    And no supervisor lock is left

  @inmem
  Scenario: each worktree shows the status gtd next gives it, grouped by project
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({
        driver: ["drive"],
        projects: { portal: { name: "Portal" } },
      })
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | plan   |
      | portal  | build  |
      | portal  | judge  |
      | api     | main   |
      | api     | stuck  |
      | api     | broken |
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And gtd next --json in "portal/build" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Building" }
      """
    And gtd next --json in "portal/judge" prints:
      """
      { "kind": "message", "actor": "judge", "idle": false, "label": "Criteria met?" }
      """
    And gtd next --json in "api/stuck" prints:
      """
      { "kind": "stalled", "actor": "human", "idle": false, "label": "Tests", "content": "the check failed 3 times\nsee the log" }
      """
    And gtd next in "api/broken" fails with:
      """
      gtd: config: gtd.config.ts: no default export
      """
    When I start gtd workspace
    Then the Projects view lists:
      | project | worktree | status          | label                                                          |
      | api     | main     | idle            | Idle                                                           |
      | api     | broken   | error           | gtd next failed — gtd: config: gtd.config.ts: no default export |
      | api     | stuck    | error (stalled) | Tests — the check failed 3 times                               |
      | Portal  | main     | idle            | Idle                                                           |
      | Portal  | build    | working         | Building                                                       |
      | Portal  | judge    | needsYou        | Criteria met?                                                  |
      | Portal  | plan     | needsYou        | Answer the plan                                                |
    And the dashboard page reads:
      """
      Projects
      api
      idle main Idle
      error broken gtd next failed — gtd: config: gtd.config.ts: no default export
      error stuck Tests — the check failed 3 times
      Portal
      idle main Idle
      working build Building
      needs you judge Criteria met?
      needs you plan Answer the plan
      """

  @inmem
  Scenario: a worktrees adapter written in gtd.workspace.ts replaces the default
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({
        adapters: {
          worktrees: {
            projects: async () => [{ id: "solo", path: "/elsewhere/solo" }],
            list: async () => [
              { path: "/elsewhere/solo", branch: "trunk", head: "a".repeat(40), main: true, integrated: false },
            ],
          },
        },
      })
      """
    When I start gtd workspace
    Then the Projects view lists:
      | project | worktree | status | label |
      | solo    | trunk    | idle   | Idle  |

  @inmem
  Scenario: an unknown key at any depth stops gtd workspace at startup
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = { limits: { maxDrive: 2 }, projects: { portal: { nmae: "Portal" } } }
      """
    When I start gtd workspace
    Then gtd workspace exits 1, printing:
      """
      gtd.workspace.ts: workspace.limits.maxDrive: is not a known key
      """
    And gtd workspace exits 1, printing:
      """
      gtd.workspace.ts: workspace.projects.portal.nmae: is not a known key
      """

  @inmem
  Scenario: a config that fails to evaluate stops gtd workspace at startup
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ pollEvery: "soon" })
      """
    When I start gtd workspace
    Then gtd workspace exits 1, printing:
      """
      workspace.pollEvery: must be a duration like "30s", "5m" or "1h"
      """

  @inmem
  Scenario: --config names a gtd.workspace.ts elsewhere
    Given a workspace file "config/main.workspace.ts" with:
      """
      export const workspace = { driver: [] }
      """
    When I start gtd workspace with "--config config/main.workspace.ts"
    Then gtd workspace exits 1, printing:
      """
      workspace.driver: must be a non-empty array of strings (an argv)
      """

  @inmem
  Scenario: without a gtd.workspace.ts there is no workspace to run
    When I start gtd workspace
    Then gtd workspace exits 1, printing:
      """
      no gtd.workspace.ts in
      """

  @inmem
  Scenario: a second supervisor for the same workspace exits 1 and names the first
    Given a workspace file "gtd.workspace.ts" with:
      """
      export const workspace = {}
      """
    When I start gtd workspace
    And I start gtd workspace
    Then gtd workspace exits 1, naming the running supervisor's pid and URL

  @inmem
  Scenario: a stopped supervisor frees the workspace for the next one
    Given a workspace file "gtd.workspace.ts" with:
      """
      export const workspace = {}
      """
    When I start gtd workspace
    And I stop gtd workspace
    Then no supervisor lock is left
    When I start gtd workspace
    Then gtd workspace serves

  @inmem
  Scenario: the dashboard refuses a tailnet login that is not in ui.users
    Given a workspace file "gtd.workspace.ts" with:
      """
      export const workspace = { ui: { users: ["me@example.com"] } }
      """
    When I start gtd workspace
    And "stranger@example.com" requests the dashboard
    Then the dashboard answers 403
    When "me@example.com" requests the dashboard
    Then the dashboard answers 200
