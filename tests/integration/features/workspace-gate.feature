@inmem
Feature: gtd workspace serves every worktree's gate page

  The one supervisor serves each worktree's gate page at
  /<project>/<worktree>/gate, where <worktree> is the branch. There is no
  gate server per worktree. Gate pages pass the same identity and POST
  checks as the dashboard, and an edit made through a gate page starts a
  recheck of that worktree at once.

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
    And gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Answer the plan", "state": "plan", "file": ".gtd/PLAN.md" }
      """
    And the file ".gtd/PLAN.md" in "portal/plan" reads:
      """
      Sketch the change.
      """

  Scenario: every listed worktree has a gate page
    When I start gtd workspace
    Then the Projects view links these gate pages:
      | project | worktree | gate               |
      | api     | main     | /api/main/gate     |
      | portal  | main     | /portal/main/gate  |
      | portal  | plan     | /portal/plan/gate  |
    And every listed gate page answers 200
    And the gate page of "portal/plan" shows the rest "Answer the plan"

  Scenario: the worktree data names the gate kind and review base
    Given gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Review", "state": "review", "file": ".gtd/REVIEW.md" }
      """
    And the file ".gtd/REVIEW.md" in "portal/plan" reads:
      """
      <!-- base: 0123456789abcdef -->
      # Review
      """
    When I start gtd workspace
    Then the Projects view shows gate kind "Review" and base "0123456" for "portal/plan"

  Scenario: a project named trpc has its gate page
    Given the worktrees adapter reports these worktrees:
      | project | branch |
      | trpc    | main   |
    When I start gtd workspace
    Then every listed gate page answers 200

  Scenario: a worktree the workspace does not list has no gate page
    When I start gtd workspace
    And "owner@example.com" sends this request to gtd workspace:
      """
      GET /portal/gone/gate
      """
    Then gtd workspace answers 404

  Scenario Outline: a gate page refuses a tailnet login that is not in ui.users
    When I start gtd workspace
    And "stranger@example.com" sends this request to gtd workspace:
      """
      <request>
      """
    Then gtd workspace answers 403

    Examples:
      | request                          |
      | GET /portal/plan/gate            |
      | GET /portal/plan/gate/trpc/step  |
      | POST /portal/plan/gate/trpc/done |

  Scenario Outline: a gate page takes only same-origin JSON POSTs
    When I start gtd workspace
    And "owner@example.com" sends this request to gtd workspace:
      """
      POST /portal/plan/gate/trpc/done
      content-type: <type>
      sec-fetch-site: <site>

      {}
      """
    Then gtd workspace answers <status>

    Examples:
      | type             | site        | status |
      | application/json | cross-site  | 403    |
      | text/plain       | same-origin | 415    |
      | application/json | same-origin | 200    |

  Scenario: a note saved through a gate page rechecks that worktree at once
    When I start gtd workspace
    And I save the note "Why now?" through the gate page of "portal/plan"
    Then the file ".gtd/PLAN.md" in "portal/plan" contains "Why now?"
    And gtd next has run in "portal/plan" since the note was saved

  Scenario: an agent rest names no gate kind
    Given gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "agent", "idle": false, "label": "Fixing", "state": "build.fixing", "file": "TODO.md" }
      """
    When I start gtd workspace
    Then the Projects view shows no gate kind for "portal/plan"

  Scenario: a review quoting a base marker in a code fence takes the real base
    Given gtd next --json in "portal/plan" prints:
      """
      { "kind": "capture", "actor": "human", "idle": false, "label": "Review", "state": "review", "file": ".gtd/SQUASH_MESSAGE.md" }
      """
    And the file ".gtd/SQUASH_MESSAGE.md" in "portal/plan" reads:
      """
      # Squash

      ```
      <!-- base: aaaaaaaaaaaa -->
      ```

      <!-- base: 0123456789abcdef -->
      """
    When I start gtd workspace
    Then the Projects view shows gate kind "Squash message" and base "0123456" for "portal/plan"
