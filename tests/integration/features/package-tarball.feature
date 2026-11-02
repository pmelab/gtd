@live @tarball
Feature: the packed package — gtd installed from its own tarball

  `npm pack` builds the tarball a release publishes, and npm installs it — the
  one package fetched — into a test project. Its companions (typescript,
  vitest, quickpickle, @types/node) are linked from this checkout. Every subpath
  resolves with types, and the driver from docs/driver.md runs a workflow on
  the installed gtd with a stub agent.

  Background:
    Given a test project
    And npm has installed gtd's packed tarball, beside typescript, vitest, quickpickle and @types/node linked from this checkout, into the test project's package.json and node_modules
    And every live gtd call, and the gtd on PATH, runs the installed bundle
    And a file ".gitignore" with:
      """
      node_modules
      """
    And the working tree is committed with message:
      """
      chore: install @pmelab/gtd
      """

  Scenario: every subpath resolves, with types, from the packed tarball
    Given a file "tsconfig.json" with:
      """
      {
        "compilerOptions": {
          "module": "nodenext",
          "moduleResolution": "nodenext",
          "target": "esnext",
          "strict": true,
          "noEmit": true,
          "skipLibCheck": true,
          "types": ["node"]
        },
        "files": ["check.ts"]
      }
      """
    And a file "check.ts" with:
      """
      import { FLOWS_PROTOCOL } from "@pmelab/gtd/flows"
      import { WIRE_SCHEMA } from "@pmelab/gtd/wire"
      import { reviewNotes } from "@pmelab/gtd/steering"
      import { lensesOf } from "@pmelab/gtd/workflow-kit"
      import { verdict } from "@pmelab/gtd/testkit"

      // @ts-expect-error each export is typed, never `any`
      export const typed: string = WIRE_SCHEMA
      export const all = [FLOWS_PROTOCOL, reviewNotes, lensesOf, verdict]
      """
    # `./testkit/gherkin` registers steps with the consumer's quickpickle.
    And a file "check.mjs" with:
      """
      import { readFileSync } from "node:fs"

      const { exports } = JSON.parse(readFileSync("node_modules/@pmelab/gtd/package.json", "utf8"))
      const subpaths = Object.keys(exports).filter((subpath) => subpath !== "./testkit/gherkin")
      for (const subpath of subpaths) await import(subpath.replace(".", "@pmelab/gtd"))
      console.log(`imported ${subpaths.join(" ")}`)
      """
    And a file "testkit.test.mjs" with:
      """
      import { expect, it } from "vitest"
      import { testRepo } from "@pmelab/gtd/testkit"

      it("loads testkit", () =>
        expect(testRepo({ workflow: { default: async () => {} } }).read("missing")).toBeUndefined())
      """
    When I run in the shell within 110 seconds:
      """
      node node_modules/typescript/bin/tsc -p . && node check.mjs && node node_modules/vitest/vitest.mjs run testkit.test.mjs
      """
    Then it succeeds
    And stdout contains "imported ./flows ./wire ./steering ./workflow-kit ./testkit"
    And stdout contains "1 passed"

  Scenario: the driver from docs/driver.md runs a workflow on the installed gtd
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, run } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "Write .gtd/REQUIREMENTS.md for the note.")
        await run("checking", "test -f .gtd/REQUIREMENTS.md && rm .gtd/REQUIREMENTS.md")
      }
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    # No judge.json from this machine: a judge gate goes to the stub, not to
    # whatever provider the developer configured.
    And an environment variable "XDG_CONFIG_HOME" set to "/nonexistent-gtd-config"
    And a stub agent script that responds to prompts with:
      """
      mkdir -p .gtd
      printf '## Impact\n\n- the calculator module\n\n## Acceptance Criteria\n\n- AC-1: a calculator exists.\n' > .gtd/REQUIREMENTS.md
      """
    And the driver pasted from docs/driver.md
    When I run the pasted script
    Then it succeeds
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      chore: install @pmelab/gtd
      chore: add gtd.config.ts
      gtd(human): idle → working
      gtd(check): gtd:pin → working
      gtd(agent): working → checking
      gtd(check): checking → gtd:unpin
      gtd(check): gtd:unpin → idle
      """

  # gtd imports a shipped subpath once a config requires it: here only as the
  # workflow runs, from a file gtd.config.ts imports. With no node_modules
  # above the config, gtd is the only thing that can serve it.
  Scenario: a workflow imports a shipped subpath as it runs
    Given the file "node_modules" is deleted
    And a gtd config file at "schema.ts" with:
      """
      export const schema = async (): Promise<number> => (await import("@pmelab/gtd/wire")).WIRE_SCHEMA
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"
      import { schema } from "./schema"

      export default async () => {
        await human("idle", { message: `wire schema ${await schema()}` })
      }
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "wire schema 1"

  Scenario: the installed gtd refuses a history in an unsupported Gtd-Format
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("review", "review it")
      }
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And the working tree is committed with message:
      """
      gtd(agent): elsewhere → review

      Gtd-Step: elsewhere#1
      Gtd-Format: 5
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains "is written in history format 5, but this gtd reads formats 1 to 4"
