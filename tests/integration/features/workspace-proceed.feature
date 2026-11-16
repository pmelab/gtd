@inmem
Feature: Proceed and Retry from the dashboard

  A worktree that needs you has Proceed, a worktree in error has Retry. gtd
  first compares the HEAD commit the person saw with the worktree's HEAD now,
  then runs the driver's one-shot `proceed <commit>` or `retry <commit>` in
  the worktree. Exit 0 accepts, exit 1 refuses with the driver's stderr, exit
  2 means no driver runs: gtd then starts the driver and sends the one-shot
  again. Each press writes a line to the audit log. A step stands in for the
  driver's one-shots: they answer 0 while the driver's pane runs, else 2.

  Background:
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({ driver: ["drive"] })
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | plan   |
      | portal  | build  |
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """
    And gtd next --json in "portal/build" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Build" }
      """

  Scenario: Proceed sends the HEAD commit the person saw to the running driver
    Given a driver that an earlier supervisor started runs in "portal/plan"
    When I start gtd workspace
    And I press Proceed on "portal/plan"
    Then gtd accepts the press
    And the driver one-shots ran:
      | worktree    | argv                 |
      | portal/plan | drive proceed <HEAD> |
    And the audit log reads:
      | identity          | endpoint      | project | worktree | action  | outcome  |
      | owner@example.com | /trpc/proceed | portal  | plan     | proceed | accepted |

  Scenario: a commit the person did not see is refused before gtd sends anything
    Given a driver that an earlier supervisor started runs in "portal/plan"
    When I start gtd workspace
    And a commit lands on "portal/plan"
    And I press Proceed on "portal/plan"
    Then gtd refuses the press with "HEAD moved since the page loaded; reload and look again"
    And the driver one-shots ran:
      | worktree | argv |
    And the Projects view shows the refusal on "portal/plan":
      """
      HEAD moved since the page loaded; reload and look again
      """
    And the audit log reads:
      | identity          | endpoint      | project | worktree | action  | outcome |
      | owner@example.com | /trpc/proceed | portal  | plan     | proceed | stale   |

  Scenario: the driver's refusal shows on the worktree
    Given a driver that an earlier supervisor started runs in "portal/plan"
    And the driver in "portal/plan" refuses one-shots with:
      """
      busy: still answering the last question
      """
    When I start gtd workspace
    And I press Proceed on "portal/plan"
    Then gtd refuses the press with "busy: still answering the last question"
    And the Projects view shows the refusal on "portal/plan":
      """
      busy: still answering the last question
      """
    And the audit log reads:
      | identity          | endpoint      | project | worktree | action  | outcome |
      | owner@example.com | /trpc/proceed | portal  | plan     | proceed | refused |

  Scenario: Proceed with no driver starts the driver, then sends the proceed again
    When I start gtd workspace
    And I press Proceed on "portal/plan"
    Then gtd accepts the press
    And gtd opened these driver panes:
      | worktree     | argv  |
      | portal/build | drive |
      | portal/plan  | drive |
    And the driver one-shots ran:
      | worktree    | argv                 |
      | portal/plan | drive proceed <HEAD> |
      | portal/plan | drive proceed <HEAD> |

  Scenario: two Proceed presses at once start one driver
    When I start gtd workspace
    And I press Proceed on "portal/plan" twice at once
    Then gtd accepts the press
    And gtd opened these driver panes:
      | worktree     | argv  |
      | portal/build | drive |
      | portal/plan  | drive |

  Scenario: Proceed gives up when the started driver never answers
    Given the driver in "portal/plan" never answers its one-shots
    When I start gtd workspace
    And I press Proceed on "portal/plan" while 10 seconds pass
    Then gtd refuses the press with "no driver runs: the driver did not answer after it started"

  Scenario: Retry after a crash starts the driver again
    When I start gtd workspace
    And the driver in "portal/build" exits 3
    Then the Projects view lists:
      | project | worktree | status          | label                            |
      | portal  | main     | idle            | Idle                             |
      | portal  | build    | error (crashed) | Build — the driver exited with 3 |
      | portal  | plan     | needsYou        | Answer the plan                  |
    When I press Retry on "portal/build"
    Then gtd accepts the press
    And the driver one-shots ran:
      | worktree     | argv               |
      | portal/build | drive retry <HEAD> |
      | portal/build | drive retry <HEAD> |
    And the Projects view lists:
      | project | worktree | status   | label           |
      | portal  | main     | idle     | Idle            |
      | portal  | build    | working  | Build           |
      | portal  | plan     | needsYou | Answer the plan |
    And the audit log reads:
      | identity          | endpoint    | project | worktree | action | outcome  |
      | owner@example.com | /trpc/retry | portal  | build    | retry  | accepted |

  Scenario: Proceed is only for a worktree that needs you, Retry only for one in error
    When I start gtd workspace
    And I press Retry on "portal/plan"
    Then gtd refuses the press with "Retry is for a worktree in error; this one needs you"
    And the driver one-shots ran:
      | worktree | argv |

  Scenario: Retry is for a worktree an error note puts in error
    Given a driver that an earlier supervisor started runs in "portal/plan"
    When I start gtd workspace
    And I run "gtd workspace note portal.wt/plan 'deploy failed' --error" in the workspace
    And I press Retry on "portal/plan"
    Then gtd accepts the press
    And the driver one-shots ran:
      | worktree    | argv               |
      | portal/plan | drive retry <HEAD> |
