@inmem
Feature: doors — named shortcuts that start a workflow with positional args

  A `gtd.config.ts` declares doors through its reserved `doors` export; the
  bundled module ships `fix` and `review [base]`. `gtd door <name> [args…]`
  starts the door's workflow exactly as `gtd --workflow` would, mapping the
  positional args to process settings; `gtd doors` lists every door. A door's
  `workflow` resolves in the merged catalogue, so a repo that shadows `review`
  gets its own behind the bundled door.

  Background:
    Given a test project
    And the workflow

  Scenario: the bundled fix and review doors are listed with no config
    When I run gtd with args "doors --json"
    Then it succeeds
    And stdout contains "[{\"name\":\"fix\",\"workflow\":\"fix\",\"args\":[]},{\"name\":\"review\",\"workflow\":\"review\",\"args\":[{\"name\":\"base\",\"optional\":true}]}]"

  Scenario: plain gtd doors prints one sorted line per door with its synopsis
    When I run gtd with args "doors"
    Then it succeeds
    And stdout contains "fix → fix"
    And stdout contains "review [base] → review"

  Scenario: gtd doors --json=<path> reads one value off the array
    When I run gtd with args "doors --json=1.args.0.name"
    Then it succeeds
    And stdout contains "base"

  Scenario: a repo door is listed beside the bundled ones
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export const hotfix = async () => {
        await agent("patch", "Patch ${vars.ticket}.")
      }

      export const defaults = { ticket: "" }

      export const doors = {
        patch: {
          workflow: "hotfix",
          args: [{ name: "ticket" }],
          vars: ({ ticket }) => ({ ticket }),
        },
      }
      """
    When I run gtd with args "doors --json"
    Then it succeeds
    And stdout contains "{\"name\":\"fix\""
    And stdout contains "{\"name\":\"patch\",\"workflow\":\"hotfix\",\"args\":[{\"name\":\"ticket\",\"optional\":false}]}"
    And stdout contains "{\"name\":\"review\""

  Scenario: gtd door starts the door's workflow with its args mapped to process settings
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
      }

      export const defaults = { ticket: "" }

      export const doors = {
        patch: {
          workflow: "hotfix",
          args: [{ name: "ticket" }],
          vars: ({ ticket }) => ({ ticket }),
        },
      }
      """
    When I run gtd with args "door patch T-42"
    Then it succeeds
    And the last commit subject is "gtd(human): patch"
    And the last commit body contains "Gtd-Workflow: hotfix"
    And the last commit body contains "Gtd-Var: ticket=T-42"

  Scenario: a repo door of the same name wins over the bundled one
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
      }

      export const doors = {
        fix: { workflow: "hotfix" },
      }
      """
    When I run gtd with args "door fix"
    Then it succeeds
    And the last commit body contains "Gtd-Workflow: hotfix"

  Scenario: a door's workflow resolves in the merged catalogue — a repo's own review sits behind the bundled review door
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export const review = async () => {
        await agent("my-review", "Review my way.")
      }
      """
    When I run gtd with args "door review"
    Then it succeeds
    And the last commit subject is "gtd(human): my-review"
    And the last commit body contains "Gtd-Workflow: review"

  Scenario: gtd door fix is gtd --workflow fix
    When I run gtd with args "door fix"
    Then it succeeds
    And the last commit body contains "Gtd-Workflow: fix"

  Scenario: gtd door review with no base reviews since the default branch's merge-base
    Given I mark the current commit as "main"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "door review"
    Then it succeeds
    And stdout contains the hash of "main"
    And the last commit body contains "Gtd-Workflow: review"

  Scenario: gtd door review <base> pins the merge-base of a diverged branch, as --var reviewBase=<base> would
    Given a commit "feat: shared work" that adds "shared.txt" with:
      """
      shared
      """
    And I mark the current commit as "shared"
    And a commit "feat: branch a work" that adds "a.txt" with:
      """
      a
      """
    And I mark the current commit as "branch-a"
    And I hard-reset to "shared"
    And a commit "feat: branch b work" that adds "b.txt" with:
      """
      b
      """
    When I run gtd with args "door review branch-a"
    Then it succeeds
    And stdout contains the hash of "shared"
    And stdout does not contain the hash of "branch-a"
    And the last commit body contains "Gtd-Var: reviewBase=branch-a"

  Scenario: an unknown door is a usage error listing every door
    When I run gtd with args "door release"
    Then the exit code is 2
    And stderr contains "unknown door \"release\" — doors: fix, review [base]"

  Scenario: too many args is a usage error naming the door's synopsis
    When I run gtd with args "door review a b"
    Then the exit code is 2
    And stderr contains "too many arguments — usage: gtd door review [base]"

  Scenario: too few args is a usage error naming the door's synopsis
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
      }

      export const doors = {
        patch: { workflow: "hotfix", args: [{ name: "ticket" }] },
      }
      """
    When I run gtd with args "door patch"
    Then the exit code is 2
    And stderr contains "missing arguments — usage: gtd door patch <ticket>"

  Scenario: gtd door with no name is a usage error
    When I run gtd with args "door"
    Then the exit code is 2
    And stderr contains "gtd door: missing name argument"

  Scenario: a door naming an unknown workflow is a config error
    Given a gtd config file at "gtd.config.ts" with:
      """
      export const doors = {
        go: { workflow: "nope" },
      }
      """
    When I run gtd with args "doors"
    Then the exit code is 1
    And stderr contains "door \"go\" names workflow \"nope\""

  Scenario: a door name outside the lowercase-kebab rule is a config error
    Given a gtd config file at "gtd.config.ts" with:
      """
      export const doors = {
        Go_Now: { workflow: "fix" },
      }
      """
    When I run gtd with args "doors"
    Then the exit code is 1
    And stderr contains "door \"Go_Now\" is not a valid door name"

  Scenario: a door refuses while a process is already underway, like gtd --workflow
    Given a file "NOTE.md" with:
      """
      a sketch
      """
    And I run gtd land
    And I record the commit count
    When I run gtd with args "door fix"
    Then it fails
    And stderr contains "gtd door fix: a process is already underway"
    And the commit count is unchanged
