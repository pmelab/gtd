@inmem
Feature: "--var" persistence across a whole process, pinned against the environment

  A `--var <name>=<value>` supplied at `gtd --workflow <name>` is resolved with
  every other process setting (defaults, `.gtdrc` `vars:`, `--var`,
  `GTD_<NAME>`) and recorded as `Gtd-Var: <name>=<value>` trailers on the
  process's FIRST commit. Every later `gtd` call reads those trailers back, so
  a `GTD_<NAME>` exported afterwards does not change the running process.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, vars } from "@pmelab/gtd/flows"

      const announce = () => agent("announcing", `Greeting: ${vars.greeting}`)

      const work = async () => {
        await agent("working", "do the work")
        await announce()
      }

      export default async () => {
        await human("idle", { message: "start" })
        await work()
      }

      export const working = work

      export const announcing = async () => {
        await announce()
      }

      export const defaults = { greeting: "hi" }
      """

  Scenario: a "--var" value supplied at start stays visible in a later turn's rendered prompt
    When I run gtd with args "--workflow working --var greeting=hello"
    Then it succeeds
    And the last commit subject is "gtd(human): working"
    Given a file "work-output.txt" with:
      """
      the agent's work
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → announcing"
    When I run gtd next
    Then it succeeds
    And stdout contains "Greeting: hello"

  Scenario: a "GTD_" environment variable exported after the start does not override the pinned "--var" value
    When I run gtd with args "--workflow announcing --var greeting=hello"
    Then it succeeds
    And the last commit subject is "gtd(human): announcing"
    Given an environment variable "GTD_GREETING" set to "fromenv"
    When I run gtd next
    Then it succeeds
    And stdout contains "Greeting: hello"
    And stdout does not contain "Greeting: fromenv"

  Scenario: a "GTD_" environment variable present at the start is pinned along with the other process settings
    Given an environment variable "GTD_GREETING" set to "fromenv"
    When I run gtd with args "--workflow announcing --var greeting=hello"
    Then it succeeds
    And the last commit body contains "Gtd-Var: greeting=fromenv"
    Given an environment variable "GTD_GREETING" set to "later"
    When I run gtd next
    Then it succeeds
    And stdout contains "Greeting: fromenv"
