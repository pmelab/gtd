@inmem
Feature: run(…, { onFail: "rest" }) rests on a failing script

  A failing body is recorded in the tree and the process rests at the step as
  `stalled`, showing the failed output. A tree change runs the script again;
  only a zero exit advances the flow.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, run } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await run("shipping", "ship-it", { onFail: "rest" })
        await agent("after", "carry on")
      }
      """
    And the working tree is committed as "chore: gtd config"

  Scenario: a failing script leaves the process stalled at the step, showing the output
    Given the shell command "ship-it" exits 3 with:
      """
      push rejected
      """
    And a file "NOTE.md" with:
      """
      Ship it.
      """
    And gtd lands "gtd(human): idle → shipping"
    And I run the pin beat
    When I run the script beat
    Then it succeeds
    When I run gtd next with "--json"
    Then stdout contains "\"kind\":\"stalled\""
    And stdout contains "push rejected"
    And the process rests at "shipping"

  Scenario: a tree change runs the script again, and a zero exit advances
    Given the shell command "ship-it" exits 3 with:
      """
      push rejected
      """
    And a file "NOTE.md" with:
      """
      Ship it.
      """
    And gtd lands "gtd(human): idle → shipping"
    And I run the pin beat
    And I run the script beat
    Given the shell command "ship-it" exits 0 with:
      """
      shipped
      """
    And a file "FIX.md" with:
      """
      fixed
      """
    When I run the script beat
    Then it succeeds
    And the last commit subject is "gtd(check): shipping → after"
    And the process rests at "after"

  Scenario: a retry failing with the same output stalls again
    Given the shell command "ship-it" exits 3 with:
      """
      push rejected
      """
    And a file "NOTE.md" with:
      """
      Ship it.
      """
    And gtd lands "gtd(human): idle → shipping"
    And I run the pin beat
    And I run the script beat
    And a file "FIX.md" with:
      """
      fixed
      """
    And I run the script beat
    When I run gtd next with "--json"
    Then stdout contains "\"kind\":\"stalled\""
    And stdout contains "push rejected"
    And the process rests at "shipping"
