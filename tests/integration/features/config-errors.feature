@inmem
Feature: An invalid workflow config fails loudly at load time, naming where

  A `gtd.config.ts` is analyzed before any of its flow code runs: a construct
  replay cannot honour — a step name that is not a literal, an `await` on
  something that is not a step, a `try` around a step, IO or nondeterminism
  in flow code, one step name at two call sites, a callback the analyzer
  cannot follow — fails the load, every finding together, each prefixed
  `gtd.config.ts:<line>:<col>:`. A `.gtdrc` keeps only `vars`, `modes` and
  `ui`; anything else there, a leftover `workflow:` key included, fails the
  load naming the file and the key. Never a silent fallback, and never
  deferred to step time.

  Scenario: a step name that is not a string literal fails naming its position
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, vars, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "start" })
          await agent(vars.stepName ?? "working", "do it")
        },
      })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "gtd.config.ts:6:17: "
    And stderr contains "the first argument of agent() must be a string literal step name"

  Scenario: an "await" on something that is not a step fails naming its position
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "start" })
          await "ready"
          await agent("working", "do it")
        },
      })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "gtd.config.ts:6:5: "
    And stderr contains "flow code may await only a step, scope(), persona(), or a function that steps"

  Scenario: a "try" around a step fails naming its position
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "start" })
          try {
            await agent("working", "do it")
          } catch {
            await human("failed", { message: "it failed" })
          }
        },
      })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "gtd.config.ts:6:5: "
    And stderr contains "try/catch around a step is not allowed"

  Scenario: the clock, randomness, the environment and the filesystem in flow code all surface in one error
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { readFileSync } from "node:fs"
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          const started = Date.now()
          await human("idle", { message: `started ${started}` })
          if (Math.random() < 0.5) await agent("lucky", "do it")
          await agent("working", process.env.PROMPT ?? readFileSync("prompt.md", "utf8"))
        },
      })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "gtd.config.ts:6:21: Date is IO or nondeterministic"
    And stderr contains "gtd.config.ts:8:9: Math.random is nondeterministic"
    And stderr contains "gtd.config.ts:9:28: process is IO or nondeterministic"
    And stderr contains "\"node:fs\" is IO"

  Scenario: a "mode:" naming no built-in and no declared mode fails, listing what is available
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr:
          validate: "adr-lint <%= it.file %>"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "start", file: ".gtd/docs/adr.md", mode: "adrs" })
        },
      })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "mode \"adrs\" is not a mode this workflow knows"
    And stderr contains "qa, review, adr"
    And stderr contains "step \"idle\""

  Scenario: a "modes:" entry declaring neither format nor validate is valid — the format-only tier
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr: {}
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "start", file: ".gtd/docs/adr.md", mode: "adr" })
        },
      })
      """
    When I run gtd next
    Then it succeeds

  Scenario: a "mode: prose" naming no "modes:" declaration fails — the engine blesses no built-in vocabulary of its own
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "start", file: ".gtd/NOTES.md", mode: "prose" })
        },
      })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "mode \"prose\" is not a mode this workflow knows (qa, review)"
    And stderr contains "step \"idle\""

  Scenario: an unknown key inside a "modes:" entry fails naming both
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr:
          validate: "adr-lint <%= it.file %>"
          lint: "also adr-lint"
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "mode \"adr\": unknown key(s) lint"

  Scenario: a malformed top-level "modes:" key fails the same way as a workflow-level one
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        qa:
          formatt: "npx prettier --write <%= it.file %>"
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "mode \"qa\": unknown key(s) formatt"

  Scenario: a leftover ".gtdrc" "workflow:" key fails with the migration message, not downstream noise
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "\"workflow\" is no longer read from a .gtdrc file"
    And stderr contains "define the workflow in gtd.config.ts"

  Scenario: a flow function that calls itself fails naming the call site
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      const again = async (): Promise<void> => {
        await agent("working", "do it")
        await again()
      }

      export default workflow({
        default: async () => {
          await human("idle", { message: "start" })
          await again()
        },
      })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "gtd.config.ts:5:9: a flow function may not call itself — write the repetition as a loop"

  Scenario: one step name at two call sites fails naming the second
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "hi" })
          await agent("working", "first")
          await agent("working", "second")
        },
      })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "gtd.config.ts:7:17: step name \"working\" is already used by another call site — wrap one of them in scope()"

  Scenario: a callback the analyzer cannot follow fails naming it, not a guess at the steps behind it
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, scope, workflow } from "@pmelab/gtd/flows"

      const phases: Record<string, () => Promise<void>> = {}

      export default workflow({
        default: async () => {
          await human("idle", { message: "hi" })
          await scope("phase", phases.build!)
        },
      })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "the callback of scope() cannot be resolved"

  Scenario: an unknown top-level config key fails with remediation naming the key and its file — unconditional, no --verbose needed
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "npm test"
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains ".gtdrc: testCommand: "
    And stderr contains "\"testCommand\" is unexpected"
