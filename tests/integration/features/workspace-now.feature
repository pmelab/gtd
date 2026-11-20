@inmem
Feature: gtd workspace now shows the Now view in the terminal

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

  Scenario: the view lists the gates that need you and jumps to the pane of one
    And a driver that an earlier supervisor started runs in "portal/plan"
    When I start gtd workspace
    And I open the Now view and press "1"
    Then the Now view shows:
      """
      > 1 portal plan needs you Answer the plan
      0 working
      focused pane-1
      """
    And the terminal focused the driver pane of "portal/plan"
