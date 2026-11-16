@inmem
Feature: gtd workspace sends notifications

  The supervisor publishes a notification through the notifications adapter
  when a worktree needs you or is in error, when a feed proposes an item or
  starts failing, and when gtd.workspace.ts does not reload. Each kind can be
  switched off for the workspace and for each project. Each key is sent once,
  also across restarts: the supervisor keeps the sent keys in its state
  store. What changed while it was down is sent once when it starts again.
  With no state store, what is true at startup is a silent baseline. Notes
  notify only when sent with --notify.

  Background:
    Given a workspace file "gtd.workspace.ts" with:
      """
      export const workspace = {}
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | plan   |
      | api     | main   |

  Scenario: a worktree that comes to need you sends one notification that links to its gate page
    When I start gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And a commit lands on "portal/plan"
    And 1 second passes
    And 30 seconds pass
    Then gtd sent these notifications:
      | key                                       | title                  | body            | link              | priority |
      | needsYou:portal/plan:<HEAD of portal/plan> | portal/plan needs you | Answer the plan | /portal/plan/gate | high     |

  Scenario: a worktree in error sends a notification that links to its detail
    When I start gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "stalled", "actor": "agent", "idle": false, "label": "Stalled" }
      """
    And a commit lands on "portal/plan"
    And 1 second passes
    Then gtd sent these notifications:
      | key                                     | title               | body    | link                                  | priority |
      | error:portal/plan:<HEAD of portal/plan> | portal/plan: error | Stalled | /?worktree=<path of portal/plan>      | high     |

  Scenario: a proposed item and a failing feed each send a notification
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
    And the command "gh issue list" prints:
      """
      []
      """
    When I start gtd workspace
    And the command "gh issue list" prints:
      """
      [{ "number": 1, "title": "Add login" }]
      """
    And the clock advances "5m"
    And the command "gh issue list" prints:
      """
      not json
      """
    And the clock advances "5m"
    And the clock advances "5m"
    Then gtd sent these notifications:
      | key                    | title                    | link | priority |
      | proposed:boardReady/1  | Proposed: Add login      | /    | default  |
      | feedFailing:boardReady | feed boardReady failing  | /    | low      |

  Scenario: a feed that fails again after it recovered sends again
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { feed } from "@pmelab/gtd/workspace"

      export const boardReady = feed({
        project: "portal",
        every: "5m",
        mode: "propose",
        poll: async (ctx) => JSON.parse((await ctx.exec(["gh", "issue", "list"])).stdout),
      })
      """
    And the command "gh issue list" prints:
      """
      []
      """
    When I start gtd workspace
    And the command "gh issue list" prints:
      """
      not json
      """
    And the clock advances "5m"
    And the command "gh issue list" prints:
      """
      []
      """
    And the clock advances "5m"
    And the command "gh issue list" prints:
      """
      not json
      """
    And the clock advances "5m"
    Then gtd sent these notifications:
      | key                    |
      | feedFailing:boardReady |
      | feedFailing:boardReady |

  Scenario: a config that does not reload sends a notification
    When I start gtd workspace
    And the workspace file "gtd.workspace.ts" changes to:
      """
      export const workspace = { notifi: {} }
      """
    And the workspace file "gtd.workspace.ts" changes to:
      """
      export const workspace = { notifi: {} }
      """
    Then gtd sent these notifications:
      | key                                       | title                         | body                                 | priority |
      | configError:workspace.notifi: is not a known key | gtd.workspace.ts not reloaded | workspace.notifi: is not a known key | default  |

  Scenario: a kind switched off for the workspace stays on for a project that switches it on
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({
        notify: { error: false },
        projects: { api: { notify: { error: true } } },
      })
      """
    When I start gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "stalled", "actor": "agent", "idle": false, "label": "Stalled" }
      """
    And gtd next --json in "api/main" prints:
      """
      { "kind": "stalled", "actor": "agent", "idle": false, "label": "Stalled" }
      """
    And a commit lands on "portal/plan"
    And a commit lands on "api/main"
    And 1 second passes
    Then gtd sent these notifications:
      | key                               |
      | error:api/main:<HEAD of api/main> |

  Scenario: a note notifies only when sent with --notify
    When I start gtd workspace
    And I run "gtd workspace note portal.wt/plan 'merged into main'" in the workspace
    And I run "gtd workspace note portal.wt/plan 'deploy failed' --error" in the workspace
    And I run "gtd workspace note portal.wt/plan 'deployed' --notify" in the workspace
    Then the command exits 0
    And gtd sent these notifications:
      | title             | body     | link                             | priority |
      | portal/plan: note | deployed | /?worktree=<path of portal/plan> | default  |

  Scenario: a spooled note with --notify is sent when the supervisor starts
    When I run "gtd workspace note portal.wt/plan 'deploy failed' --error --notify" in the workspace
    And I start gtd workspace
    Then gtd sent these notifications:
      | title                   | body          | priority |
      | portal/plan: error note | deploy failed | high     |

  Scenario: a restart sends no key twice
    When I start gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And a commit lands on "portal/plan"
    And 1 second passes
    And I stop gtd workspace
    And I start gtd workspace
    Then gtd sent these notifications:
      | key                                       |
      | needsYou:portal/plan:<HEAD of portal/plan> |

  Scenario: what changed while the supervisor was down is sent once when it starts
    When I start gtd workspace
    And I stop gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And a commit lands on "portal/plan"
    And I start gtd workspace
    Then gtd sent these notifications:
      | key                                       |
      | needsYou:portal/plan:<HEAD of portal/plan> |

  Scenario: without a state store, startup is a silent baseline
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { feed } from "@pmelab/gtd/workspace"

      export const boardReady = feed({
        project: "portal",
        every: "5m",
        mode: "propose",
        poll: async () => [{ key: "1", title: "Add login", action: "start:feature", priority: 0 }],
      })
      """
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    When I start gtd workspace
    And the clock advances "5m"
    Then gtd sent no notification
    When I stop gtd workspace
    And I delete the supervisor's state directory
    And I start gtd workspace
    Then gtd sent no notification

  Scenario: a notification that cannot be published is reported and not sent again
    Given publishing a notification fails with "no route to ntfy.sh"
    When I start gtd workspace
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "stalled", "actor": "agent", "idle": false, "label": "Stalled" }
      """
    And a commit lands on "portal/plan"
    And 1 second passes
    And 30 seconds pass
    Then the supervisor printed:
      """
      not sent: no route to ntfy.sh
      """
    And gtd sent no notification

  Scenario: with the default notifications, the supervisor prints where to subscribe
    When I start gtd workspace
    Then the supervisor printed:
      """
      notifications: subscribe to https://ntfy.sh/gtd-topic-of-this-workspace
      """
