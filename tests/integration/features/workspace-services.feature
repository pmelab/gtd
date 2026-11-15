Feature: each worktree shows its service chips

  The services adapter reports the services of each worktree: name, URL,
  running, error. The Projects view shows them next to the worktree, and each
  URL is a link, so the running app opens with one tap. gtd owns no DNS: it
  links to the URLs the adapter reports. Scenarios run the supervisor
  in-process with the services adapter's twin.

  @inmem
  Scenario: each worktree shows the services the adapter reports for it
    Given a workspace file "gtd.workspace.ts" with:
      """
      export const workspace = {}
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
      | portal  | login  |
      | api     | main   |
    And the services adapter reports these services:
      | worktree     | service | url                                | running | error       |
      | portal/main  | web     | https://web.portal.example.ts.net  | yes     |             |
      | portal/login | web     | https://web.login.portal.example.ts.net | no |             |
      | portal/login | jobs    |                                    | no      | exit code 3 |
    When I start gtd workspace
    Then the Projects view shows these service chips:
      | worktree     | service | url                                     | running | error       |
      | portal/main  | web     | https://web.portal.example.ts.net       | yes     |             |
      | portal/login | web     | https://web.login.portal.example.ts.net | no      |             |
      | portal/login | jobs    |                                         | no      | exit code 3 |

  @inmem
  Scenario: the services are listed again every pollEvery, not on each request
    Given a workspace file "gtd.workspace.ts" with:
      """
      export const workspace = { pollEvery: "20s" }
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
    When I start gtd workspace
    And the services adapter reports these services:
      | worktree    | service | url | running | error |
      | portal/main | web     |     | yes     |       |
    And 10 seconds pass
    Then the Projects view shows these service chips:
      | worktree | service | url | running | error |
    When 10 seconds pass
    Then the Projects view shows these service chips:
      | worktree    | service | url | running | error |
      | portal/main | web     |     | yes     |       |

  @inmem
  Scenario: a services adapter that fails keeps the worktrees and says so
    Given a workspace file "gtd.workspace.ts" with:
      """
      export const workspace = {}
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
    And the services adapter fails with "the pitchfork supervisor is not running"
    When I start gtd workspace
    Then the Projects view lists:
      | project | worktree | status | label |
      | portal  | main     | idle   | Idle  |
    And the Projects view shows "portal/main" with services unavailable: "the pitchfork supervisor is not running"

  @inmem
  Scenario: a services adapter written in gtd.workspace.ts replaces the default
    Given a workspace file "gtd.workspace.ts" with:
      """
      import { defineWorkspace } from "@pmelab/gtd/workspace"

      export const workspace = defineWorkspace({
        adapters: {
          services: {
            list: async () => [{ name: "app", url: "http://localhost:3000", running: true, error: undefined }],
            up: async () => {},
            down: async () => {},
          },
        },
      })
      """
    And the worktrees adapter reports these worktrees:
      | project | branch |
      | portal  | main   |
    When I start gtd workspace
    Then the Projects view shows these service chips:
      | worktree    | service | url                   | running | error |
      | portal/main | app     | http://localhost:3000 | yes     |       |
