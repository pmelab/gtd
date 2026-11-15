@inmem
Feature: gtd workspace runs reactions on worktree status changes

  A reaction is a named reaction() export of gtd.workspace.ts. Its run gets
  each worktree status change that matches its `on` filter, once, with the
  commit the worktree is at. Through its ctx it can run an action, Proceed,
  Retry, notify, run a command and log, as a person can. The supervisor keeps
  the last worktree statuses: a change that happened while it was down is
  delivered once when it starts again, with atStartup set. Without a state
  store, startup is a silent baseline. A run that throws is reported and
  stops nothing else.

  Background:
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | plan   |
      | portal  | build  |

  Scenario: only the reactions whose filter matches the change run
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { reaction } from "@pmelab/gtd/workspace"

      export const driverErrors = reaction({
        on: { to: "error", errorKind: "driver" },
        run: (change, ctx) => {
          ctx.log(`${change.project}/${change.branch}: ${change.from} -> ${change.to} at ${change.commit}`)
        },
      })

      export const stalls = reaction({
        on: { to: "error", errorKind: "stalled" },
        run: (change, ctx) => ctx.log(`${change.branch} stalled`),
      })

      export const anyChange = reaction({
        on: {},
        run: (change, ctx) => ctx.log(`${change.branch}: ${change.from} -> ${change.to}`),
      })
      """
    And gtd next --json in "portal/build" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    And a driver that an earlier supervisor started runs in "portal/build"
    When I start gtd workspace
    And the driver in "portal/build" reports:
      """
      { "state": "error", "msg": "the model refused" }
      """
    Then the reactions logged:
      """
      reaction anyChange: build: working -> error
      reaction driverErrors: portal/build: working -> error at <HEAD of portal/build>
      """

  Scenario: each change is delivered once, also across a restart
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { reaction } from "@pmelab/gtd/workspace"

      export const needs = reaction({
        on: { to: "needsYou" },
        run: (change, ctx) => ctx.log(`${change.branch} needs you; at startup: ${change.atStartup}`),
      })
      """
    When I start gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And a commit lands on "portal/plan"
    And 1 second passes
    And a commit lands on "portal/plan"
    And 1 second passes
    And 30 seconds pass
    And I stop gtd workspace
    And I start gtd workspace
    And 30 seconds pass
    Then the reactions logged:
      """
      reaction needs: plan needs you; at startup: false
      """

  Scenario: a change that happened while the supervisor was down is delivered at startup
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { reaction } from "@pmelab/gtd/workspace"

      export const needs = reaction({
        on: { from: "idle", to: "needsYou" },
        run: (change, ctx) => ctx.log(`${change.branch} needs you; at startup: ${change.atStartup}`),
      })
      """
    When I start gtd workspace
    And I stop gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And a commit lands on "portal/plan"
    And I start gtd workspace
    Then the reactions logged:
      """
      reaction needs: plan needs you; at startup: true
      """

  Scenario: without a state store, startup is a silent baseline
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { reaction } from "@pmelab/gtd/workspace"

      export const anyChange = reaction({
        on: {},
        run: (change, ctx) => ctx.log(`${change.branch}: ${change.from} -> ${change.to}`),
      })
      """
    When I start gtd workspace
    And I stop gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And a commit lands on "portal/plan"
    And I delete the supervisor's state directory
    And I start gtd workspace
    Then the reactions logged:
      """
      """

  Scenario: a reloaded gtd.workspace.ts runs its own reactions
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { reaction } from "@pmelab/gtd/workspace"

      export const first = reaction({ on: {}, run: (change, ctx) => ctx.log(change.branch ?? "") })
      """
    When I start gtd workspace
    And the workspace file "gtd.workspace.ts" changes to:
      """
      import { reaction } from "@pmelab/gtd/workspace"

      export const second = reaction({ on: {}, run: (change, ctx) => ctx.log(change.branch ?? "") })
      """
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And a commit lands on "portal/plan"
    And 1 second passes
    Then the reactions logged:
      """
      reaction second: plan
      """

  Scenario: a reaction that throws is reported, and the other reactions still run
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { reaction } from "@pmelab/gtd/workspace"

      export const broken = reaction({
        on: { to: "needsYou" },
        run: async () => {
          throw new Error("triage service is down")
        },
      })

      export const works = reaction({
        on: { to: "needsYou" },
        run: (change, ctx) => ctx.log(`${change.branch} needs you`),
      })
      """
    When I start gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And a commit lands on "portal/plan"
    And 1 second passes
    And gtd next --json in "portal/build" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Review the build" }
      """
    And a commit lands on "portal/build"
    And 1 second passes
    Then the reactions logged:
      """
      reaction works: plan needs you
      reaction works: build needs you
      """
    And the supervisor printed:
      """
      reaction broken failed: triage service is down
      """

  Scenario: a reaction retries a crashed driver as the dashboard does
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, reaction } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })

      export const autofix = reaction({
        on: { to: "error", errorKind: "crashed" },
        run: async (change, ctx) => {
          const outcome = await ctx.retry(change.commit)
          ctx.log(`retry: ${JSON.stringify(outcome)}`)
        },
      })
      """
    And gtd next --json in "portal/build" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """
    When I start gtd workspace
    And the driver in "portal/build" exits 3
    Then the reactions logged:
      """
      reaction autofix: retry: {"ok":true}
      """
    And the driver one-shots ran:
      | worktree     | argv               |
      | portal/build | drive retry <HEAD> |
      | portal/build | drive retry <HEAD> |
    And the audit log reads:
      | identity | endpoint         | project | worktree | action | outcome  |
      | -        | reaction:autofix | portal  | build    | retry  | accepted |

  Scenario: a reaction that proceeds from a stale commit is refused as a person is
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, reaction } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })

      export const approve = reaction({
        on: { to: "needsYou" },
        run: async (change, ctx) => {
          const outcome = await ctx.proceed("0000000000000000000000000000000000000000")
          ctx.log(`proceed: ${JSON.stringify(outcome)}`)
        },
      })
      """
    When I start gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And a commit lands on "portal/plan"
    And 1 second passes
    Then the reactions logged:
      """
      reaction approve: proceed: {"ok":false,"message":"HEAD moved since the page loaded; reload and look again"}
      """

  Scenario: a reaction runs a command, an action and a notification in the worktree
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace, reaction } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ notify: { error: false } })

      export const triage = reaction({
        on: { to: "error" },
        run: async (change, ctx) => {
          const out = await ctx.exec(["triage", change.branch ?? ""])
          const ran = await ctx.action("error:fix", { hint: out.stdout.trim() })
          ctx.log(`action: ${JSON.stringify(ran)}`)
          await ctx.notify({ title: `triaged ${change.branch}`, body: out.stdout.trim() })
        },
      })
      """
    And the actions adapter offers these actions:
      """
      [
        {
          "id": "error:fix",
          "label": "Try a fix",
          "status": "error",
          "fields": [{ "name": "hint", "type": "text", "required": false }]
        }
      ]
      """
    And the command "triage plan" prints:
      """
      flaky test
      """
    When I start gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "stalled", "actor": "agent", "idle": false, "label": "Stalled" }
      """
    And a commit lands on "portal/plan"
    And 1 second passes
    Then the reactions logged:
      """
      reaction triage: action: {"ok":true}
      """
    And gtd opened these action panes:
      | worktree    | argv                              |
      | portal/plan | ["error:fix","--hint=flaky test"] |
    And gtd sent these notifications:
      | title        | body       | link                             | priority |
      | triaged plan | flaky test | /?worktree=<path of portal/plan> | default  |

  Scenario: an error note is a change to error of kind note
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { reaction } from "@pmelab/gtd/workspace"

      export const failedDeploys = reaction({
        on: { to: "error", errorKind: "note" },
        run: (change, ctx) => ctx.log(`${change.branch}: ${change.message}`),
      })
      """
    When I start gtd workspace
    And I run "gtd workspace note portal.wt/plan 'deploy failed' --error" in the workspace
    Then the command exits 0
    And the reactions logged:
      """
      reaction failedDeploys: plan: deploy failed
      """
