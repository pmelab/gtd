@live @tarball
Feature: the packed package — gtd installed from its own tarball

  `npm pack` builds the tarball a release publishes, and npm installs it — the
  one package fetched — into a test project. Its companions (typescript,
  vitest, quickpickle, @types/node) are linked from this checkout. Every subpath
  resolves with types, the installed `gtd install` scaffolds a config from the
  per-workflow subpaths, and the driver from docs/driver.md runs the feature
  workflow on the installed gtd with a stub agent.

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
      import shipped from "@pmelab/gtd/workflows"
      import feature from "@pmelab/gtd/workflows/feature"
      import review from "@pmelab/gtd/workflows/review"
      import fix from "@pmelab/gtd/workflows/fix"
      import { feature as legacy } from "@pmelab/gtd/workflow"
      import { InMemRepo } from "@pmelab/gtd/testkit"

      // @ts-expect-error each export is typed, never `any`
      export const typed: string = WIRE_SCHEMA
      export const all = [FLOWS_PROTOCOL, reviewNotes, lensesOf, shipped, feature, review, fix, legacy, InMemRepo]
      """
    # `./testkit` runs inside the consumer's vitest.
    And a file "check.mjs" with:
      """
      import { readFileSync } from "node:fs"

      const { exports } = JSON.parse(readFileSync("node_modules/@pmelab/gtd/package.json", "utf8"))
      const subpaths = Object.keys(exports).filter((subpath) => subpath !== "./testkit")
      for (const subpath of subpaths) await import(subpath.replace(".", "@pmelab/gtd"))
      console.log(`imported ${subpaths.join(" ")}`)
      """
    And a file "testkit.test.mjs" with:
      """
      import { expect, it } from "vitest"
      import { InMemRepo } from "@pmelab/gtd/testkit"

      it("loads testkit", () => expect(new InMemRepo().readFile("missing")).toBeUndefined())
      """
    When I run in the shell within 110 seconds:
      """
      node node_modules/typescript/bin/tsc -p . && node check.mjs && node node_modules/vitest/vitest.mjs run testkit.test.mjs
      """
    Then it succeeds
    And stdout contains "imported ./flows ./wire ./steering ./workflow-kit ./workflows ./workflows/feature ./workflows/review ./workflows/fix ./workflow"
    And stdout contains "1 passed"

  Scenario: the driver from docs/driver.md runs the feature workflow on the installed gtd
    Given I run gtd with args "install"
    And the working tree is committed
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And an environment variable "GTD_TESTCOMMAND" set to "true"
    And a stub agent script that responds to prompts with:
      """
      mkdir -p .gtd
      printf '## Acceptance Criteria\n\n- AC-1: a calculator exists.\n' > .gtd/REQUIREMENTS.md
      """
    And the driver pasted from docs/driver.md
    When I run the driver from the docs
    Then it succeeds
    And "gtd.config.ts" contains "from \"@pmelab/gtd/workflows/feature\""
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      chore: install @pmelab/gtd
      chore: commit working tree
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.answer
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
    Given I run gtd with args "install"
    And the working tree is committed
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And the working tree is committed with message:
      """
      gtd(agent): elsewhere → review

      Gtd-Step: elsewhere#1
      Gtd-Format: 2
      """
    When I run gtd next
    Then the exit code is 1
    And stderr contains "is written in history format 2, but this gtd reads format 1"
