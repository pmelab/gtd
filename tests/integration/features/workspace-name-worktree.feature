@inmem
Feature: New worktree asks for a description when the workspace names worktrees

  With `nameWorktree` in `gtd.workspace.ts`, the New worktree form takes a
  description. gtd asks the hook for the branch, checks it like any branch and
  creates the worktree on it.

  Background:
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({
        driver: ["drive"],
        nameWorktree: async (text, { project }) => {
          if (text === "boom") throw new Error("no name for boom")
          if (text === "bad") return { branch: "two words", description: text }
          if (text === "dup") return { branch: "login", description: text }
          return { branch: `${project}-${text.toLowerCase().replace(/ /g, "-")}`, description: text }
        },
      })
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | login  |

  Scenario: A description creates a worktree on the branch the hook returns
    When I start gtd workspace
    And I create a worktree described "Fix Login" in "portal"
    Then gtd made these adapter calls:
      | call             | worktree                |
      | worktrees.create | portal/portal-fix-login |
      | services.up      | portal/portal-fix-login |
    And the worktree "portal/portal-fix-login" was created with the description "Fix Login"

  Scenario Outline: A description that gives no usable worktree is refused
    When I start gtd workspace
    And I create a worktree described "<description>" in "portal"
    Then gtd refuses the worktree change with:
      """
      <message>
      """
    And gtd made no adapter calls

    Examples:
      | description | message                                           |
      |             | a description is required                         |
      | boom        | no name for boom                                  |
      | bad         | a branch name has no spaces or control characters |
      | dup         | portal has a worktree on login already            |
