@inmem
Feature: process settings are pinned at process start, environment settings are read live

  A process setting (`defaults`, `.gtdrc` `vars:`) changes which step comes
  next, so it is resolved once and recorded as `Gtd-Var:` trailers in the
  process's first commit; later edits and `GTD_<NAME>` exports are ignored for
  the running process. An environment setting (`envDefaults`, `.gtdrc` `env:`)
  only changes how a step runs on this machine, so it is read fresh on every
  call and never recorded.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, env, human, refuse, vars } from "@pmelab/gtd/flows"

      export default async ({ entry }) => {
        if (entry !== undefined) refuse(`"${entry}" is not an enterable state`)
        await human("idle", { message: "start" })
        await agent("working", "do the work")
        if (vars.route === "fast") {
          await agent("fast", `fast lane, check with ${env.checker}`)
        } else {
          await agent("slow", `slow lane, check with ${env.checker}`)
        }
      }

      export const defaults = { route: "fast" }
      export const envDefaults = { checker: "make check" }
      """
    And a file "NOTE.md" with:
      """
      a note
      """

  Scenario: the landing that starts an ordinary process carries every process setting as a Gtd-Var trailer
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"
    And the last commit body contains "Gtd-Var: route=fast"
    And the last commit body does not contain "Gtd-Var: checker"

  Scenario: a process setting edited in .gtdrc mid-process does not re-route the process
    Given gtd lands "gtd(human): idle → working"
    And a file ".gtdrc" with:
      """
      vars:
        route: slow
      """
    And a file "work.txt" with:
      """
      done
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → fast"
    When I run gtd next
    Then it succeeds
    And stdout contains "fast lane"

  Scenario: a pinned value survives a GTD_<NAME> export
    Given gtd lands "gtd(human): idle → working"
    And an environment variable "GTD_ROUTE" set to "slow"
    And a file "work.txt" with:
      """
      done
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → fast"

  Scenario: a process setting set through GTD_<NAME> at the start is the one pinned
    Given an environment variable "GTD_ROUTE" set to "slow"
    When I run gtd land
    Then it succeeds
    And the last commit body contains "Gtd-Var: route=slow"

  Scenario: an environment setting edited in .gtdrc mid-process shows on the next step
    Given gtd lands "gtd(human): idle → working"
    And a file "work.txt" with:
      """
      done
      """
    And gtd lands "gtd(agent): working → fast"
    When I run gtd next
    Then it succeeds
    And stdout contains "check with make check"
    Given a file ".gtdrc" with:
      """
      env:
        checker: just check
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "check with just check"

  Scenario: GTD_<NAME> overrides an environment setting on any call
    Given gtd lands "gtd(human): idle → working"
    And a file "work.txt" with:
      """
      done
      """
    And gtd lands "gtd(agent): working → fast"
    And an environment variable "GTD_CHECKER" set to "ci check"
    When I run gtd next
    Then it succeeds
    And stdout contains "check with ci check"

  Scenario: an environment setting under vars: fails to load, naming env:
    Given a gtd config file at ".gtdrc" with:
      """
      vars:
        checker: just check
      """
    When I run gtd next
    Then it fails
    And stderr contains "\"vars.checker\" is an environment setting — move it under \"env:\""

  Scenario: a process setting under env: fails to load, naming vars:
    Given a gtd config file at ".gtdrc" with:
      """
      env:
        route: slow
      """
    When I run gtd next
    Then it fails
    And stderr contains "\"env.route\" is a process setting — move it under \"vars:\""

  Scenario: a multi-line process setting refuses the first landing, naming the setting
    Given a file ".gtdrc" with:
      """
      vars:
        route: |
          fast
          slow
      """
    When I run gtd land
    Then it fails
    And stderr contains "process setting \"route\" spans several lines"
