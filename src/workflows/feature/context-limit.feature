@inmem
Feature: the shipped workflows take a context limit as an option

  `contextLimit: { soft, hard }` is a factory option: every agent step of the
  workflow runs under it, carried as `gtd next --json`'s `context`. Without it a
  step carries none and the driver's defaults apply.

  Scenario Outline: every agent step carries the configured limit, or none
    Given a gtd config with:
      """
      import { feature } from "@pmelab/gtd/workflows/feature"
      export { summary, steering, skills, access } from "@pmelab/gtd/workflows/feature"
      export default feature(<options>)
      """
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed as "feat: add calculator"
    And a file "TODO.md" with:
      """
      # Add subtract

      subtract(a, b) returns the difference.
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    When the process is driven
    Then the process rests at "design.triage"
    And the output of gtd "next --json" <carries>

    Examples:
      | options                                     | carries                                             |
      | { contextLimit: { soft: 0.5, hard: 0.65 } } | contains "\"context\":{\"soft\":0.5,\"hard\":0.65}" |
      | { contextLimit: { hard: 0.8 } }             | contains "\"context\":{\"hard\":0.8}"               |
      | {}                                          | does not contain "\"context\""                      |

