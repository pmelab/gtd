@live
Feature: the core bundle — the engine a pinned process runs

  `dist/gtd.core.mjs` is gtd minified without the ui and the language server,
  shipped beside `dist/gtd.bundle.mjs`. Judges stay in it: verdicts decide the
  path. `@live` because only the built file shows what it carries.

  Background:
    Given a test project
    And every live gtd call, and the gtd on PATH, runs this build's "dist/gtd.core.mjs"
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, read } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write .gtd/NEXT.md to start" })
        await agent("building", `Implement:\n${read(".gtd/NEXT.md") ?? ""}`)
      }
      """

  Scenario: next and land drive a process
    Given a file ".gtd/NEXT.md" with:
      """
      build the thing
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "State: idle"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"
    When I run gtd next
    Then it succeeds
    And stdout contains "build the thing"

  Scenario Outline: gtd <tool> is not available
    When I run gtd with "<tool>"
    Then the exit code is 1
    And stderr contains "gtd <tool>: could not load — not available in a pinned process"

    Examples:
      | tool |
      | ui   |
      | lsp  |
