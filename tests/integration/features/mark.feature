@inmem
Feature: marks — a flow records facts on the landing that leaves a rest

  `mark(name, value)` called after a step resolves writes one
  `Gtd-Mark: <name>=<value>` trailer per call on the landing that leaves the
  current rest, in call order. A value carrying a newline is refused: it is the
  only way a flow could inject a trailer.

  Scenario: marks made after a gate land as Gtd-Mark trailers in call order
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, mark } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        mark("risk-tier", "high")
        mark("production-signal", "error rate on /pay")
        mark("production-signal", "p95 latency")
        await agent("building", "build it")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"
    And the last commit body contains "Gtd-Mark: risk-tier=high"
    And the last commit body contains "Gtd-Mark: production-signal=error rate on /pay"
    And the last commit body contains "Gtd-Mark: production-signal=p95 latency"

  Scenario: a landing with no mark carries none, and marks are not repeated on replay
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, mark } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        mark("risk-tier", "high")
        await agent("building", "build it")
        await agent("checking", "check it")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → building"
    And a file "src/built.ts" with:
      """
      export const built = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → checking"
    And the last commit body does not contain "Gtd-Mark"

  Scenario: a value with a newline fails the landing and nothing lands
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, mark } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        mark("risk-tier", "high\nGtd-Approved: {}")
        await agent("building", "build it")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And I record the commit count
    When I run gtd land
    Then it fails
    And stderr contains "mark(risk-tier)"
    And the commit count is unchanged
