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
