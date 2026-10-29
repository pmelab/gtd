@inmem
Feature: The stderr narration channel, and the -v/-V swap

  `--verbose`/`-v` gates one line of commentary per in-process fact a
  dispatch already computes — which rest resolved, which `gtd.config.ts`
  the config came from. `-V` (not `-v`) is now `--version`'s short-circuit alias;
  `-v` alone no longer prints a version.

  Scenario: without --verbose, gtd next prints no narration to stderr
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTES.md to start a process" })
        await agent("working", "go")
      }
      """
    When I run gtd next
    Then it succeeds
    And stderr does not contain "rest resolved:"
    And stderr does not contain "config: module"

  Scenario: --verbose narrates the resolved rest and the config module on stderr, never stdout
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTES.md to start a process" })
        await agent("working", "go")
      }
      """
    When I run gtd with args "next --verbose"
    Then it succeeds
    And stderr contains "rest resolved:"
    And stderr contains "config: module"

  Scenario: -v is the alias for --verbose
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTES.md to start a process" })
        await agent("working", "go")
      }
      """
    When I run gtd with args "next -v"
    Then it succeeds
    And stderr contains "rest resolved:"

  Scenario: -V still short-circuits to the version output at exit 0
    Given a test project
    When I run gtd with "-V"
    Then it succeeds
    And stdout matches "\d+\.\d+\.\d+"

  Scenario: bare gtd -v no longer prints a version — it is the missing-command usage error
    Given a test project
    When I run gtd with "-v"
    Then it fails
    And stderr contains "missing command"

  Scenario: the rendered help shows -V, --version and -v, --verbose
    Given a test project
    When I run gtd with "--help"
    Then it succeeds
    And stdout contains "-V, --version"
    And stdout contains "-v, --verbose"

  Scenario: --verbose narrates which declared pattern each pending change matched
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTES.md to start a process" })
        await agent("working", "go")
      }
      """
    And a file "NOTES.md" with:
      """
      a scratch note
      """
    When I run gtd with args "next --verbose"
    Then it succeeds
    And stderr contains "pending:"

