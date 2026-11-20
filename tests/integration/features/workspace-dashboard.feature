@inmem
Feature: the dashboard

  The dashboard at `/` is gtd's web client, told by the page to open the
  dashboard and to read its API at `/trpc`.

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

  Scenario: a worktree resting on a human is flagged, one resting on the agent is not
    Given gtd next --json in "portal/build" prints:
      """
      { "kind": "prompt", "actor": "agent", "idle": false, "label": "Building" }
      """
    When I start gtd workspace
    Then the Projects view flags these worktrees as at a human gate:
      | project | worktree | humanRest |
      | portal  | main     | false     |
      | portal  | build    | false     |
      | portal  | plan     | true      |

  Scenario: the dashboard is the web client, with its API at /trpc
    When I start gtd workspace
    Then the dashboard page names these meta tags:
      | name     | content   |
      | gtd-page | workspace |
      | gtd-trpc | /trpc     |

  Scenario: the dashboard is a home-screen app
    When I start gtd workspace
    Then the dashboard page has these home-screen meta tags:
      | name                                   | content |
      | apple-mobile-web-app-capable           | yes     |
      | apple-mobile-web-app-status-bar-style  | default |
    And the dashboard page links the manifest "/manifest.webmanifest"
    And the dashboard viewport has "viewport-fit=cover" and "interactive-widget=resizes-content"
    And the dashboard manifest is a standalone app named "gtd" with theme_color, background_color and 2 icons
