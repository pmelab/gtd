@inmem
Feature: a gtd.config.ts builds on the bundled workflow through @pmelab/gtd/workflow

  `@pmelab/gtd/workflow` is the bundled workflow as a module: its default export
  (`feature`) is the flow gtd runs without a `gtd.config.ts`, and its phases, steps,
  `defaults`, `summary`, `base`, `steering` and `skills` are named exports. A
  workflow of its own can re-export what it keeps and compose the rest, and the
  steps it reuses keep their full names — `skills` included, since dropping it
  from the re-export list the way dropping any other named export does
  silently empties every reused step's skill list instead of keeping the
  bundled defaults.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { start } from "@pmelab/gtd/flows"
      import { afterTail, buildTail } from "@pmelab/gtd/workflow"

      export { defaults, envDefaults, summary, base, steering, skills } from "@pmelab/gtd/workflow"

      export const hotfix = async () => afterTail(await buildTail(true, start()))
      """

  Scenario: an ordinary start runs the bundled flow, resting at its idle step
    When I run gtd next
    Then it succeeds
    And stdout contains "No active gtd process"

  Scenario: a new named workflow reuses the bundled build tail, whose steps keep their full names
    When I run gtd with args "--workflow hotfix"
    Then it succeeds
    And the last commit subject is "gtd(human): build.fix"
    Given a file "src/fix.ts" with:
      """
      export const fixed = true
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"

  Scenario: the bundled defaults are the reusing workflow's own
    When I run gtd with args "--workflow hotfix --var judgeBudgetBytes=65536"
    Then it succeeds
    And the last commit subject is "gtd(human): build.fix"
    And the last commit body contains "Gtd-Var: judgeBudgetBytes=65536"

  Scenario: the re-exported skills export keeps scope build's bundled skill list — the re-export, not a literal, is what resolves it here
    When I run gtd with args "--workflow hotfix"
    Then it succeeds
    And the last commit subject is "gtd(human): build.fix"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"debugging-and-error-recovery\""

  Scenario: a .gtdrc skills: entry addresses scope build through the re-exported skills, the same as it would in the bundled workflow itself
    Given a gtd config file at ".gtdrc" with:
      """
      skills:
        build: [my-org-runbook]
      """
    When I run gtd with args "--workflow hotfix"
    Then it succeeds
    And the last commit subject is "gtd(human): build.fix"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"my-org-runbook\""
    And stdout does not contain "debugging-and-error-recovery"
