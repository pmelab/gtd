@live
Feature: a repository without a package.json runs its workflows

  gtd serves `@pmelab/gtd/*` imports itself; no package.json needed.

  Scenario: a root gtd.config.ts runs a workflow from start to idle with no package.json or install
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"
      import { FIX_BOX } from "@pmelab/gtd/steering"

      export default async () => {
        await human("idle", { message: `write NOTE.md to start a process (${FIX_BOX})` })
        await agent("working", "develop the note, then sign off")
      }
      """
    And a file "NOTE.md" with:
      """
      Remember the milk.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"
    When I run the pin beat
    Then the last commit subject is "gtd(check): gtd:pin → working"
    Given a file "notes/milk.md" with:
      """
      The milk is remembered.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → gtd:unpin"
    When I run the unpin beat
    Then the last commit subject is "gtd(check): gtd:unpin → idle"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"idle\":true"

  Scenario: an installed @pmelab/gtd in node_modules is ignored in favour of gtd's own copy
    Given a test project
    And a file "node_modules/@pmelab/gtd/package.json" with:
      """
      {"name":"@pmelab/gtd","version":"0.0.0","type":"module","exports":{"./steering":"./steering.js","./flows":"./flows.js"}}
      """
    And a file "node_modules/@pmelab/gtd/steering.js" with:
      """
      throw new Error("project node_modules copy was used")
      """
    And a file "node_modules/@pmelab/gtd/flows.js" with:
      """
      throw new Error("project node_modules copy was used")
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"
      import { FIX_BOX } from "@pmelab/gtd/steering"

      export default async () => {
        await human("idle", { message: `nothing to do (${FIX_BOX})` })
      }
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"idle\":true"
