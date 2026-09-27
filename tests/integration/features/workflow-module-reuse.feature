@inmem
Feature: a gtd.config.ts builds on the bundled workflow through @pmelab/gtd/workflow

  `@pmelab/gtd/workflow` is the bundled workflow as a module: its default export
  is the flow gtd runs without a `gtd.config.ts`, and its phases, steps,
  `defaults`, `summary`, `base` and `steering` are named exports. A workflow of its own can
  re-export what it keeps and compose the rest, and the steps it reuses keep
  their full names.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { start } from "@pmelab/gtd/flows"
      import bundled, { afterTail, buildTail } from "@pmelab/gtd/workflow"

      export { defaults, summary, base, steering } from "@pmelab/gtd/workflow"

      export default async ({ entry }) =>
        entry === "hotfix" ? afterTail(await buildTail(true, start())) : bundled({ entry })
      """

  Scenario: an ordinary start runs the bundled flow, resting at its idle step
    When I run gtd next
    Then it succeeds
    And stdout contains "No active gtd process"

  Scenario: a new entry reuses the bundled build tail, whose steps keep their full names
    When I run gtd with args "--entry hotfix"
    Then it succeeds
    And the last commit subject is "gtd(human): hotfix"
    Given a file "src/fix.ts" with:
      """
      export const fixed = true
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"

  Scenario: the bundled defaults are the reusing workflow's own
    When I run gtd with args "--entry hotfix --var testCommand=true"
    Then it succeeds
    And the last commit subject is "gtd(human): hotfix"
