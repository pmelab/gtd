Feature: a config change during a running process is visible

  The landing that starts a process records a `Gtd-Config: <hash> <path>`
  trailer for `gtd.config.ts` and every local module it imports. Every later
  command compares those hashes with the files on disk and, on a difference,
  warns naming the changed files — a warning, not an error, since fixing a
  config mid-process is legitimate. A process started before the trailer
  existed replays without one, and without a warning.

  Background:
    Given a test project
    And a file "brief.ts" with:
      """
      export const brief = "do the work"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"
      import { brief } from "./brief.js"

      const work = async () => {
        await agent("working", brief)
        await agent("polishing", "polish the work")
      }

      export default async () => {
        await human("idle", { message: "start" })
        await work()
      }

      export const working = work
      """

  @inmem
  Scenario: a "--workflow" start records the hash of the config and of its local import
    When I run gtd with args "--workflow working"
    Then it succeeds
    And the last commit subject is "gtd(human): working"
    And the last commit body contains "Gtd-Config: c59960854e8032b7 brief.ts"
    And the last commit body contains "Gtd-Config: c7f10857be1c6f92 gtd.config.ts"

  @inmem
  Scenario: the landing that starts an ordinary process records the hashes too
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"
    And the last commit body contains "Gtd-Config: c59960854e8032b7 brief.ts"

  @inmem
  Scenario: an unchanged config warns about nothing
    When I run gtd with args "--workflow working"
    Then it succeeds
    When I run gtd next
    Then it succeeds
    And stderr does not contain "the config changed since this process started"

  @inmem
  Scenario: changing a local import mid-process warns, naming the file, and the process goes on
    When I run gtd with args "--workflow working"
    Then it succeeds
    Given a file "brief.ts" with:
      """
      export const brief = "do the work, differently"
      """
    When I run gtd next
    Then it succeeds
    And stderr contains "the config changed since this process started (brief.ts)"
    And stdout contains "do the work, differently"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → polishing"
    And the last commit body does not contain "Gtd-Config:"
    When I run gtd next
    Then it succeeds
    And stderr contains "the config changed since this process started (brief.ts)"

  @inmem
  Scenario: a process started before the trailer existed replays without a warning
    Given the working tree is committed with message:
      """
      gtd(human): working

      Gtd-Workflow: working
      Gtd-Format: 1
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "do the work"
    And stderr does not contain "the config changed since this process started"

  @live
  Scenario: a pre-commit hook reformatting the config while the process starts warns about nothing
    Given an executable pre-commit hook with:
      """
      #!/bin/sh
      if git diff --cached --name-only | grep -qx brief.ts; then
        sed 's/  */ /g' brief.ts > brief.ts.tmp && mv brief.ts.tmp brief.ts
        git add brief.ts
      fi
      """
    And a file "brief.ts" with:
      """
      export const brief  =  "do the work"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"
    When I run gtd next
    Then it succeeds
    And stderr does not contain "the config changed since this process started"

  @inmem
  Scenario: a config that makes a step the process already entered its first step still warns
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"
    Given a file "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("working", { message: "start" })
        await agent("polishing", "polish the work")
      }
      """
    When I run gtd next
    Then it succeeds
    And stderr contains "the config changed since this process started (brief.ts, gtd.config.ts)"

  @inmem
  Scenario: answering a judge step after a config change warns once
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judge } from "@pmelab/gtd/flows"
      import { brief } from "./brief.js"

      export default async () => {
        await human("idle", { message: "start" })
        await agent("working", brief)
      }

      export const judged = async () => {
        await judge("judging", {
          questions: [{ id: "q1", primitive: "noul", instructions: brief, criteria: "c" }],
          evidence: { note: "x" },
          message: "judge it",
        })
        await agent("acting", brief)
      }
      """
    When I run gtd with args "--workflow judged"
    Then it succeeds
    And the last commit subject is "gtd(human): judging"
    Given a file "brief.ts" with:
      """
      export const brief = "do the work, differently"
      """
    When I run gtd judge answer with stdin:
      """
      [{"id":"q1","answer":true,"p":0.9}]
      """
    Then it succeeds
    And stderr contains "the config changed since this process started (brief.ts)" exactly once
