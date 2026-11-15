Feature: gtd ui — tailnet identity and same-origin POST checks

  Every request to `gtd ui` needs a tailnet identity listed in `ui.users`
  (default: the user that owns the node). Under `tailscale serve` the identity
  is the `Tailscale-User-Login` header; on a direct bind it is what
  `tailscale whois` says about the peer. Behind `--http` the local proxy is
  trusted. Any other identity gets 403. A state change is a POST with a JSON
  content type and `Sec-Fetch-Site: same-origin` or an `Origin` that matches
  the host; a GET never changes state. The in-memory tailnet's node owner is
  "owner@example.com".

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "Sketch the change in .gtd/TODO.md.", file: ".gtd/TODO.md" })
      }
      """

  @inmem
  Scenario Outline: an identity that is not the node owner gets 403 for every route
    When "mallory@example.com" sends this request to gtd ui over tailscale serve:
      """
      <request>
      content-type: application/json
      sec-fetch-site: same-origin
      """
    Then gtd ui answers 403

    Examples:
      | request             |
      | GET /               |
      | GET /trpc/step      |
      | POST /trpc/done     |
      | POST /trpc/setValue |

  @inmem
  Scenario: the node owner is let in over tailscale serve
    When "owner@example.com" sends this request to gtd ui over tailscale serve:
      """
      GET /trpc/step
      """
    Then gtd ui answers 200

  @inmem
  Scenario: on a direct bind, tailscale whois names the identity
    When "mallory@example.com" sends this request to gtd ui on a direct bind:
      """
      GET /
      """
    Then gtd ui answers 403

  @inmem
  Scenario: on a direct bind, the node owner named by tailscale whois is let in
    When "owner@example.com" sends this request to gtd ui on a direct bind:
      """
      GET /
      """
    Then gtd ui answers 200

  @inmem
  Scenario: ui.users replaces the node owner
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "Sketch the change in .gtd/TODO.md.", file: ".gtd/TODO.md" })
      }

      export const config = { ui: { users: ["alice@example.com"] } }
      """
    When "owner@example.com" sends this request to gtd ui over tailscale serve:
      """
      GET /
      """
    Then gtd ui answers 403
    When "alice@example.com" sends this request to gtd ui over tailscale serve:
      """
      GET /
      """
    Then gtd ui answers 200

  @inmem
  Scenario: behind --http, the local proxy is trusted with the identity
    When "mallory@example.com" sends this request to gtd ui behind --http:
      """
      GET /trpc/step
      """
    Then gtd ui answers 200

  @inmem
  Scenario: a cross-site POST is refused and writes nothing
    When "owner@example.com" sends this request to gtd ui over tailscale serve:
      """
      POST /trpc/setValue
      content-type: application/json
      sec-fetch-site: cross-site
      origin: https://evil.example.com

      {"filePath":".gtd/TODO.md","expectedHeadSha":"","expectedContentHash":"","anchor":{"kind":"paragraph","line":0},"text":"forged"}
      """
    Then gtd ui answers 403
    And the file ".gtd/TODO.md" does not contain "forged"

  @inmem
  Scenario: a POST from the same origin passes the check
    When "owner@example.com" sends this request to gtd ui over tailscale serve:
      """
      POST /trpc/done
      content-type: application/json
      host: test-node.tailnet.ts.net:8443
      origin: https://test-node.tailnet.ts.net:8443

      {}
      """
    Then gtd ui answers 200

  @inmem
  Scenario: a POST with no Sec-Fetch-Site and no Origin is refused
    When "owner@example.com" sends this request to gtd ui over tailscale serve:
      """
      POST /trpc/done
      content-type: application/json

      {}
      """
    Then gtd ui answers 403

  @inmem
  Scenario: a POST that is not JSON is refused, behind --http too
    When "owner@example.com" sends this request to gtd ui behind --http:
      """
      POST /trpc/done
      content-type: text/plain
      sec-fetch-site: same-origin

      {}
      """
    Then gtd ui answers 415

  @inmem
  Scenario: a GET never changes state
    When "owner@example.com" sends this request to gtd ui over tailscale serve:
      """
      GET /trpc/done?input=%7B%7D
      """
    Then gtd ui answers 405
