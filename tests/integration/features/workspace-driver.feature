@inmem
Feature: gtd workspace starts drivers in their own panes and reads their status

  The supervisor starts the configured driver command through the terminal
  adapter, as the only command of a new pane. The worktree status combines
  `gtd next --json` with the root OSC 7501 record and the exit code of the
  driver's pane. Scenarios run the supervisor in-process with the terminal
  adapter's twin; a step stands in for what the driver prints or how it exits.

  Background:
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({
        driver: ["drive"],
        projects: { api: { driver: ["api-drive", "--fast"] } },
      })
      """

  Scenario: the driver's OSC record makes a worktree working, needing you, or in error
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | build  |
      | portal  | plan   |
      | portal  | ask    |
      | portal  | broke  |
    And gtd next --json in "portal/build" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And gtd next --json in "portal/ask" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    And gtd next --json in "portal/broke" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    And a driver that an earlier supervisor started runs in "portal/build"
    And a driver that an earlier supervisor started runs in "portal/plan"
    And a driver that an earlier supervisor started runs in "portal/ask"
    And a driver that an earlier supervisor started runs in "portal/broke"
    And the driver in "portal/build" reports:
      """
      { "state": "working", "title": "Writing the tests" }
      """
    And the driver in "portal/plan" reports:
      """
      { "state": "blocked", "kind": "question", "title": "Edit the plan" }
      """
    And the driver in "portal/ask" reports:
      """
      { "state": "blocked", "kind": "permission", "title": "Run npm install?" }
      """
    And the driver in "portal/broke" reports:
      """
      { "state": "error", "msg": "the API key is missing" }
      """
    When I start gtd workspace
    Then the Projects view lists:
      | project | worktree | status              | label                          |
      | portal  | main     | idle                | Idle                           |
      | portal  | ask      | needsYou (permission) | Run npm install?             |
      | portal  | broke    | error (driver)      | Build — the API key is missing |
      | portal  | build    | working             | Writing the tests              |
      | portal  | plan     | needsYou (question) | Edit the plan                  |
    And gtd opened these driver panes:
      | worktree | argv |

  Scenario: a driver that prints no OSC record still gets needs you, working, idle and error
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | build  |
      | portal  | plan   |
      | portal  | stuck  |
    And gtd next --json in "portal/build" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And gtd next --json in "portal/stuck" prints:
      """
      { "kind": "stalled", "actor": "human", "idle": false, "label": "Tests", "content": "the check failed 3 times" }
      """
    And a driver that an earlier supervisor started runs in "portal/main"
    And a driver that an earlier supervisor started runs in "portal/build"
    And a driver that an earlier supervisor started runs in "portal/plan"
    And a driver that an earlier supervisor started runs in "portal/stuck"
    When I start gtd workspace
    And the driver in "portal/main" exits 0
    Then the Projects view lists:
      | project | worktree | status          | label                            |
      | portal  | main     | idle            | Idle                             |
      | portal  | build    | working         | Build                            |
      | portal  | plan     | needsYou        | Answer the plan                  |
      | portal  | stuck    | error (stalled) | Tests — the check failed 3 times |

  Scenario: the driver's exit code tells a quit from a crash
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | crash  |
      | portal  | ctrlc  |
      | portal  | term   |
      | portal  | quit   |
    And gtd next --json in "portal/crash" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    And gtd next --json in "portal/ctrlc" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    And gtd next --json in "portal/term" prints:
      """
      { "kind": "script", "actor": "check", "idle": false, "label": "Tests" }
      """
    And gtd next --json in "portal/quit" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    When I start gtd workspace
    And the driver in "portal/crash" exits 1
    And the driver in "portal/ctrlc" exits 130
    And the driver in "portal/term" exits 143
    And the driver in "portal/quit" exits 0
    Then the Projects view lists:
      | project | worktree | status          | label                             |
      | portal  | main     | idle            | Idle                              |
      | portal  | crash    | error (crashed) | Build — the driver exited with 1  |
      | portal  | ctrlc    | needsYou        | Build — no driver runs            |
      | portal  | quit     | needsYou        | Build — no driver runs            |
      | portal  | term     | needsYou        | Tests — no driver runs            |

  Scenario: a crashed driver is not restarted, not even by the next supervisor
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | build  |
    And gtd next --json in "portal/build" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    When I start gtd workspace
    And the driver in "portal/build" exits 2
    And I stop gtd workspace
    And I start gtd workspace
    Then the Projects view lists:
      | project | worktree | status          | label                            |
      | portal  | main     | idle            | Idle                             |
      | portal  | build    | error (crashed) | Build — the driver exited with 2 |
    And gtd opened these driver panes:
      | worktree     | argv  |
      | portal/build | drive |

  Scenario: the supervisor restarts orphans when it starts, and its drivers outlive it
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | build  |
      | portal  | check  |
      | portal  | plan   |
      | portal  | busy   |
      | api     | main   |
      | api     | fix    |
    And gtd next --json in "portal/build" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    And gtd next --json in "portal/check" prints:
      """
      { "kind": "script", "actor": "check", "idle": false, "label": "Tests" }
      """
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And gtd next --json in "portal/busy" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    And gtd next --json in "api/fix" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Fix" }
      """
    And a driver that an earlier supervisor started runs in "portal/check"
    And the driver pane of "portal/check" is gone
    And a driver that an earlier supervisor started runs in "portal/busy"
    When I start gtd workspace
    Then gtd opened these driver panes:
      | worktree     | argv             |
      | api/fix      | api-drive --fast |
      | portal/build | drive            |
      | portal/check | drive            |
    And the Projects view lists:
      | project | worktree | status   | label           |
      | api     | main     | idle     | Idle            |
      | api     | fix      | working  | Fix             |
      | portal  | main     | idle     | Idle            |
      | portal  | build    | working  | Build           |
      | portal  | busy     | working  | Build           |
      | portal  | check    | working  | Tests           |
      | portal  | plan     | needsYou | Answer the plan |
    When I stop gtd workspace
    Then the driver in "portal/build" still runs
