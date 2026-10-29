@inmem
Feature: gtd start — start a workflow or a door by name

  `gtd start <name> [args…] [--var k=v]` starts a new process: through a door
  when `<name>` is one, else on the workflow of that name. Bare `gtd start`
  lists what it can start. `gtd --workflow`, `gtd door` and `gtd doors` keep
  working as the older spellings.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("building", "Build it.")
      }

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
      }

      export const audit = async () => {
        await agent("auditing", "Audit it.")
      }

      export const defaults = { ticket: "", depth: "shallow" }

      export const doors = {
        patch: {
          workflow: "hotfix",
          args: [{ name: "ticket" }],
          vars: ({ ticket }) => ({ ticket }),
        },
        audit: { workflow: "hotfix" },
      }
      """

  Scenario: bare gtd start lists every workflow and door, writing nothing
    Given I record the commit count
    When I run gtd with args "start"
    Then it succeeds
    And stdout is:
      """
      workflow audit
      workflow hotfix
      door audit → hotfix
      door patch <ticket> → hotfix
      """
    And the commit count is unchanged

  Scenario: bare gtd start --json prints the list as one array
    When I run gtd with args "start --json"
    Then it succeeds
    And stdout contains "[{\"kind\":\"workflow\",\"name\":\"audit\"},{\"kind\":\"workflow\",\"name\":\"hotfix\"},{\"kind\":\"door\",\"name\":\"audit\",\"workflow\":\"hotfix\",\"args\":[]},{\"kind\":\"door\",\"name\":\"patch\",\"workflow\":\"hotfix\",\"args\":[{\"name\":\"ticket\",\"optional\":false}]}]"

  Scenario: gtd start <workflow> starts it, pinning --var settings
    When I run gtd with args "start hotfix --var ticket=T-1"
    Then it succeeds
    And the last commit subject is "gtd(human): patch"
    And the last commit body contains "Gtd-Workflow: hotfix"
    And the last commit body contains "Gtd-Var: ticket=T-1"

  Scenario: gtd start <door> maps its args to settings, --var pinning more on top
    When I run gtd with args "start patch T-42 --var depth=deep"
    Then it succeeds
    And the last commit body contains "Gtd-Workflow: hotfix"
    And the last commit body contains "Gtd-Var: ticket=T-42"
    And the last commit body contains "Gtd-Var: depth=deep"

  Scenario: a door shadows the workflow of the same name, which --workflow still reaches
    When I run gtd with args "start audit"
    Then it succeeds
    And the last commit body contains "Gtd-Workflow: hotfix"
    When I run gtd with args "abandon"
    Then it succeeds
    When I run gtd with args "--workflow audit"
    Then it succeeds
    And the last commit body contains "Gtd-Workflow: audit"

  Scenario: -- ends the options, so a door arg may start with a dash
    When I run gtd with args "start patch -- --T-7"
    Then it succeeds
    And the last commit body contains "Gtd-Var: ticket=--T-7"

  Scenario: an unknown name is a usage error pointing at the list
    Given I record the commit count
    When I run gtd with args "start release"
    Then the exit code is 2
    And stdout is empty
    And stderr contains "gtd start release: no workflow or door is named \"release\" — run `gtd start` to list them"
    And the commit count is unchanged

  Scenario: a workflow takes no positional args
    When I run gtd with args "start hotfix T-1"
    Then the exit code is 2
    And stderr contains "gtd start hotfix: too many arguments — a workflow takes none"

  Scenario: a door's wrong number of args names its synopsis under gtd start
    When I run gtd with args "start patch"
    Then the exit code is 2
    And stderr contains "gtd start patch: missing arguments — usage: gtd start patch <ticket>"

  Scenario: --var with no name is a usage error
    When I run gtd with args "start --var ticket=T-1"
    Then the exit code is 2
    And stderr contains "gtd start: --var needs a <name>"

  Scenario: gtd start refuses while a process is already underway
    Given a file "NOTE.md" with:
      """
      a sketch
      """
    And I run gtd land
    And I record the commit count
    When I run gtd with args "start hotfix"
    Then it fails
    And stderr contains "gtd start hotfix: a process is already underway"
    And the commit count is unchanged

  Scenario: gtd start --json=script is the script, run like any other
    Given I record the commit count
    When I run in the shell:
      """
      gtd start patch T-9 --json=script | sh
      """
    Then it succeeds
    And the commit count increased by 1
    And the last commit body contains "Gtd-Var: ticket=T-9"

  Scenario: a config with nothing to start by name says so on stderr
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }
      """
    When I run gtd with args "start"
    Then it succeeds
    And stdout is empty
    And stderr contains "gtd start: this config exports no workflow besides its default"
