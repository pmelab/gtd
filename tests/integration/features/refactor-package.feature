@inmem
Feature: refactorFirst derives a behaviour-neutral refactor package from a stray report

  `refactorFirst(shape)` turns a `refactor-first` stray report into
  `.gtd/REFACTOR.md`, builds it inside the strays only, refuses a
  turn that touches another path or adds a flag read, keeps the suite green,
  and removes the package file when it closes. The stray report, fixed at
  derivation, is what the guard enforces — never the package file.

  Background:
    Given a test project
    And a file "src/a.ts" with:
      """
      export const a = process.env.GTD_FLAG_ONE
      """
    And a file "src/b.ts" with:
      """
      export const b = 1
      """
    And a file "src/c.ts" with:
      """
      export const c = 1
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"
      import { refactorFirst } from "@pmelab/gtd/workflows"

      export { defaults, envDefaults } from "@pmelab/gtd/workflows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        const refactored = await refactorFirst({
          choice: "refactor-first",
          strays: ["src/a.ts", "src/b.ts"],
          unreadable: [],
          judgment: undefined,
        })
        await agent("next", refactored ? "refactor closed" : "no refactor derived")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """

  Scenario: a refactor-first report writes the package listing exactly the strays and rests at building
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → refactor.deriving"
    When I run the emitted script and land
    Then it succeeds
    And the last commit subject is "gtd(check): refactor.deriving → refactor.building"
    And ".gtd/REFACTOR.md" contains "## Scope (read-only)"
    And ".gtd/REFACTOR.md" contains "src/a.ts"
    And ".gtd/REFACTOR.md" contains "src/b.ts"
    And ".gtd/REFACTOR.md" does not contain "src/c.ts"
    And the process rests at "refactor.building"

  Scenario: a land report derives no package and reaches the caller's next step
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"
      import { refactorFirst } from "@pmelab/gtd/workflows"

      export { defaults, envDefaults } from "@pmelab/gtd/workflows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        const refactored = await refactorFirst({
          choice: "land",
          strays: ["src/a.ts", "src/b.ts"],
          unreadable: [],
          judgment: undefined,
        })
        await agent("next", refactored ? "refactor closed" : "no refactor derived")
      }
      """
    And the working tree is committed as "chore: land config"
    And a file "NOTE.md" with:
      """
      Build another thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → next"
    And ".gtd/REFACTOR.md" does not exist

  Scenario: a build turn changing a non-stray is refused by the write access and nothing lands
    Given gtd lands "gtd(human): idle → refactor.deriving"
    And I run the emitted script and land
    And a file "src/c.ts" with:
      """
      export const c = 2
      """
    When I run gtd land
    Then it fails
    And stderr contains "src/c.ts"
    And the last commit subject is "gtd(check): refactor.deriving → refactor.building"

  Scenario: widening the package file's scope list does not widen the write access
    Given gtd lands "gtd(human): idle → refactor.deriving"
    And I run the emitted script and land
    And ".gtd/REFACTOR.md" is modified to:
      """
      ## Scope (read-only)

      - src/a.ts
      - src/b.ts
      - src/c.ts
      """
    And a file "src/c.ts" with:
      """
      export const c = 2
      """
    When I run gtd land
    Then it fails
    And stderr contains "src/c.ts"

  Scenario: a build turn adding a read of a new flag is refused
    Given gtd lands "gtd(human): idle → refactor.deriving"
    And I run the emitted script and land
    And a file "src/b.ts" with:
      """
      export const b = process.env.GTD_FLAG_TWO
      """
    When I run gtd land
    Then it fails
    And stderr contains "refactor-flags"
    And stderr contains "GTD_FLAG_TWO"

  Scenario: a lookahead-only flag pattern is refused before the first step
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"
      import { refactorFirst } from "@pmelab/gtd/workflows"

      export { envDefaults } from "@pmelab/gtd/workflows"

      export const defaults = { refactorFlagPattern: "(?=GTD_FLAG_\\w+)" }

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        const refactored = await refactorFirst({
          choice: "refactor-first",
          strays: ["src/a.ts", "src/b.ts"],
          unreadable: [],
          judgment: undefined,
        })
        await agent("next", refactored ? "refactor closed" : "no refactor derived")
      }
      """
    And the working tree is committed as "chore: lookahead config"
    And a file "NOTE.md" with:
      """
      Build another thing.
      """
    When I run gtd land
    Then it fails
    And stderr contains "refactorFlagPattern"
    And the last commit subject is "chore: lookahead config"

  Scenario: a build turn moving an existing flag read between strays lands
    Given gtd lands "gtd(human): idle → refactor.deriving"
    And I run the emitted script and land
    And a file "src/a.ts" with:
      """
      export const a = 1
      """
    And a file "src/b.ts" with:
      """
      export const b = process.env.GTD_FLAG_ONE
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): refactor.building → refactor.health.check"

  Scenario: a red suite after the build enters the fix loop, where an out-of-scope fix is refused by the write access
    Given gtd lands "gtd(human): idle → refactor.deriving"
    And I run the emitted script and land
    And a file "src/b.ts" with:
      """
      export const b = 2
      """
    And gtd lands "gtd(agent): refactor.building → refactor.health.check"
    And an environment variable "GTD_TESTCOMMAND" set to "run-full-suite"
    And the shell command "run-full-suite" exits 1 with:
      """
      full-suite-ran
      """
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): refactor.health.check → refactor.fix.suite.fixing"
    Given a file "src/c.ts" with:
      """
      export const c = 2
      """
    When I run gtd land
    Then it fails
    And stderr contains "src/c.ts"

  Scenario: a green suite after the build closes the refactor and removes the package file
    Given gtd lands "gtd(human): idle → refactor.deriving"
    And I run the emitted script and land
    And a file "src/b.ts" with:
      """
      export const b = 2
      """
    And gtd lands "gtd(agent): refactor.building → refactor.health.check"
    And gtd lands "gtd(check): refactor.health.check → refactor.closing"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/REFACTOR.md" does not exist

  Scenario: the scope guard compares exact paths where a glob stray widens the write access
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"
      import { refactorFirst } from "@pmelab/gtd/workflows"

      export { defaults, envDefaults } from "@pmelab/gtd/workflows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await refactorFirst({
          choice: "refactor-first",
          strays: ["src/*.ts"],
          unreadable: [],
          judgment: undefined,
        })
        await agent("next", "refactor closed")
      }
      """
    And the working tree is committed as "chore: glob config"
    And a file "NOTE.md" with:
      """
      Build another thing.
      """
    And gtd lands "gtd(human): idle → refactor.deriving"
    And I run the emitted script and land
    And a file "src/c.ts" with:
      """
      export const c = 2
      """
    When I run gtd land
    Then it fails
    And stderr contains "refactor-scope"
    And stderr contains "src/c.ts"

  Scenario: an escalation describe turn adding a flag read is refused
    Given gtd lands "gtd(human): idle → refactor.deriving"
    And I run the emitted script and land
    And a file "src/b.ts" with:
      """
      export const b = 2
      """
    And gtd lands "gtd(agent): refactor.building → refactor.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 1 failed
      """
    And gtd lands "gtd(check): refactor.health.check → refactor.fix.suite.fixing"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file ".gtd/fix-1.md" with:
      """
      fixed attempt 1
      """
    And gtd lands "gtd(agent): refactor.fix.suite.fixing → refactor.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 2 failed
      """
    And gtd lands "gtd(check): refactor.health.check → refactor.health.judge"
    And gtd lands "gtd(judge): refactor.health.judge → refactor.fix.suite.fixing"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file ".gtd/fix-2.md" with:
      """
      fixed attempt 2
      """
    And gtd lands "gtd(agent): refactor.fix.suite.fixing → refactor.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 3 failed
      """
    And gtd lands "gtd(check): refactor.health.check → refactor.health.judge"
    And gtd lands "gtd(judge): refactor.health.judge → refactor.fix.suite.fixing"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file ".gtd/fix-3.md" with:
      """
      fixed attempt 3
      """
    And gtd lands "gtd(agent): refactor.fix.suite.fixing → refactor.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 4 failed
      """
    And gtd lands "gtd(check): refactor.health.check → refactor.health.judge"
    And gtd lands "gtd(judge): refactor.health.judge → refactor.health.describe"
    And a file ".gtd/ESCALATION.md" with:
      """
      The suite keeps failing.
      """
    And a file "src/b.ts" with:
      """
      export const b = process.env.GTD_FLAG_TWO
      """
    When I run gtd land
    Then it fails
    And stderr contains "refactor-flags"
    And stderr contains "GTD_FLAG_TWO"

  Scenario: a person's edit outside the strays at the escalation rest lands
    Given gtd lands "gtd(human): idle → refactor.deriving"
    And I run the emitted script and land
    And a file "src/b.ts" with:
      """
      export const b = 2
      """
    And gtd lands "gtd(agent): refactor.building → refactor.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 1 failed
      """
    And gtd lands "gtd(check): refactor.health.check → refactor.fix.suite.fixing"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file ".gtd/fix-1.md" with:
      """
      fixed attempt 1
      """
    And gtd lands "gtd(agent): refactor.fix.suite.fixing → refactor.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 2 failed
      """
    And gtd lands "gtd(check): refactor.health.check → refactor.health.judge"
    And gtd lands "gtd(judge): refactor.health.judge → refactor.fix.suite.fixing"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file ".gtd/fix-2.md" with:
      """
      fixed attempt 2
      """
    And gtd lands "gtd(agent): refactor.fix.suite.fixing → refactor.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 3 failed
      """
    And gtd lands "gtd(check): refactor.health.check → refactor.health.judge"
    And gtd lands "gtd(judge): refactor.health.judge → refactor.fix.suite.fixing"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file ".gtd/fix-3.md" with:
      """
      fixed attempt 3
      """
    And gtd lands "gtd(agent): refactor.fix.suite.fixing → refactor.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      attempt 4 failed
      """
    And gtd lands "gtd(check): refactor.health.check → refactor.health.judge"
    And gtd lands "gtd(judge): refactor.health.judge → refactor.health.describe"
    And a file ".gtd/ESCALATION.md" with:
      """
      The suite keeps failing.
      """
    And gtd lands "gtd(agent): refactor.health.describe → refactor.health.stop"
    And a file "src/c.ts" with:
      """
      export const c = 2
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): refactor.health.stop → refactor.fix.suite.fixing"

  Scenario: a build turn changing a test file is refused even when the shape named it a stray
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"
      import { refactorFirst } from "@pmelab/gtd/workflows"

      export { defaults, envDefaults } from "@pmelab/gtd/workflows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await refactorFirst({
          choice: "refactor-first",
          strays: ["src/a.ts", "src/a.test.ts"],
          unreadable: [],
          judgment: undefined,
        })
        await agent("next", "refactor closed")
      }
      """
    And the working tree is committed as "chore: test stray config"
    And a file "NOTE.md" with:
      """
      Build another thing.
      """
    And gtd lands "gtd(human): idle → refactor.deriving"
    And I run the emitted script and land
    And ".gtd/REFACTOR.md" contains "never a test file"
    And a file "src/a.test.ts" with:
      """
      export const covered = true
      """
    When I run gtd land
    Then it fails
    And stderr contains "outside its write access"
    And stderr contains "src/a.test.ts"
    And the last commit subject is "gtd(check): refactor.deriving → refactor.building"
