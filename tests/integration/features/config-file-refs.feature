@live
Feature: gtd.config.ts reads a sibling prompt file at load time

  A workflow is a TypeScript module, so a prompt kept in its own file is read
  by the module itself — at its top level, relative to the module
  (`new URL("./prompt.md", import.meta.url)`) — when gtd loads the config.
  Real disk I/O, so this feature runs `@live`. A missing file fails the load,
  and the error names the file and the config that asked for it.

  Scenario: a "./"-relative prompt value is inlined from a file next to the config
    Given a test project
    And a file "gtd.config.ts" with:
      """
      import { readFileSync } from "node:fs"
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      const prompt = readFileSync(new URL("./prompt.md", import.meta.url), "utf8")

      export default workflow(async () => {
        await human("idle", { message: "go" })
        await agent("working", prompt)
      })
      """
    And a file "prompt.md" with:
      """
      Build the thing described in NOTE.md.
      """
    And "gtd.config.ts" is staged
    And "prompt.md" is staged
    When I commit with message "chore: add config"
    Given a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the thing described in NOTE.md."

  Scenario: a missing "./"-relative content value is a load error naming the file and the config
    Given a test project
    And a file "gtd.config.ts" with:
      """
      import { readFileSync } from "node:fs"
      import { human, workflow } from "@pmelab/gtd/flows"

      const message = readFileSync(new URL("./missing-message.md", import.meta.url), "utf8")

      export default workflow(async () => {
        await human("idle", { message })
      })
      """
    And "gtd.config.ts" is staged
    When I commit with message "chore: add config"
    When I run gtd next
    Then it fails
    And stderr contains "missing-message.md"
    And stderr contains "no such file or directory"
    And stderr contains "gtd.config.ts"
