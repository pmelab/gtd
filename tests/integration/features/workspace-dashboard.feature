@inmem
Feature: the dashboard and the Terminal tab of a worktree's detail

  The dashboard at `/` is gtd's web client, told by the page to open the
  dashboard and to read its API at `/trpc`. A worktree's detail pane has a
  Terminal tab: it attaches to the driver's pane with what the terminal
  adapter's `attach` answers (a command or a URL), or opens a separate shell
  pane in the worktree. Scenarios run the supervisor in-process with the
  terminal twin; the twin's `attach` answers the format a step gives, with
  `<handle>` replaced by the pane's handle.

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
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan" }
      """

  Scenario: the dashboard is the web client, with its API at /trpc
    When I start gtd workspace
    Then the dashboard page names these meta tags:
      | name     | content   |
      | gtd-page | workspace |
      | gtd-trpc | /trpc     |

  Scenario: the Terminal tab attaches to the driver's pane
    Given the terminal adapter attaches to a pane with "tmux attach -t <handle>"
    And a driver that an earlier supervisor started runs in "portal/plan"
    When I start gtd workspace
    Then the Terminal tab of "portal/plan" attaches to the driver's pane with "tmux attach -t <handle>"

  Scenario: a worktree with no driver pane has nothing to attach to
    Given the terminal adapter attaches to a pane with "tmux attach -t <handle>"
    When I start gtd workspace
    Then the Terminal tab of "portal/main" offers no attach

  Scenario: a terminal adapter without attach offers none
    Given a driver that an earlier supervisor started runs in "portal/plan"
    When I start gtd workspace
    Then the Terminal tab of "portal/plan" offers no attach

  Scenario: the Terminal tab opens a separate shell pane beside the driver
    Given the terminal adapter attaches to a pane with "https://term.example.ts.net/<handle>"
    And the person's login shell is "/bin/zsh"
    And a driver that an earlier supervisor started runs in "portal/plan"
    When I start gtd workspace
    And I open a shell pane in "portal/plan"
    Then gtd opened these shell panes:
      | worktree    | argv         |
      | portal/plan | ["/bin/zsh"] |
    And the shell pane of "portal/plan" attaches with "https://term.example.ts.net/<handle>"
    And the driver in "portal/plan" still runs
    And the audit log reads:
      | identity          | endpoint        | project | worktree | action | outcome  |
      | owner@example.com | /trpc/openShell | portal  | plan     | shell  | accepted |

  Scenario: a shell pane for a worktree the project does not have is refused
    When I start gtd workspace
    And I open a shell pane in "portal/plan" as if it were in project "api"
    Then gtd workspace answers 404
    And gtd opened these shell panes:
      | worktree | argv |
