Feature: gtd bundle — the pin of the current workflow

  `gtd bundle` prints a pin: a plain-text header line naming the pin format
  and the gtd version, then gtd's engine and the current workflow — the config
  and every module it imports — as one gzipped ES module. The workflow
  registers itself ahead of the engine, which runs it instead of loading
  gtd.config.ts. gtd writes no file; nothing runs a pin yet.

  Background:
    Given a test project
    And a file "lib/message.ts" with:
      """
      export const message = "write .gtd/NEXT.md, pinned"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, read } from "@pmelab/gtd/flows"
      import { message } from "./lib/message.js"

      export default async () => {
        await human("idle", { message })
        await agent("building", `Implement:\n${read(".gtd/NEXT.md") ?? ""}`)
      }
      """

  @inmem
  Scenario: the pin carries the workflow and every module it imports
    When I run gtd bundle
    Then it succeeds
    And the pin's header names pin format 1 and the gtd version under test
    And the pin carries "write .gtd/NEXT.md, pinned"
    And the pin carries "Implement:"

  @inmem
  Scenario: a workflow gtd refuses is never pinned
    Given a gtd config file at "gtd.config.ts" with:
      """
      export const nothing = 1
      """
    When I run gtd bundle
    Then the exit code is 1
    And stderr contains "no default export"

  @live
  Scenario: the pin runs as the engine, on the workflow it was made from
    When I run gtd bundle
    And I save the pin as ".gtd/process.gtdpin"
    And a file "lib/message.ts" with:
      """
      export const message = "edited since"
      """
    And I run the pin ".gtd/process.gtdpin" with "next"
    Then it succeeds
    And stdout contains "State: idle"
    And stdout contains "write .gtd/NEXT.md, pinned"
    And stdout does not contain "edited since"

  @live
  Scenario: git diffs the pin as binary
    When I run gtd bundle
    And I save the pin as ".gtd/process.gtdpin"
    And I run in the shell:
      """
      git add .gtd/process.gtdpin && git diff --cached -- .gtd/process.gtdpin
      """
    Then it succeeds
    And stdout contains "Binary files /dev/null and b/.gtd/process.gtdpin differ"
