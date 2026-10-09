@inmem
Feature: file access is declared per scope

  `scope({ name, access: { read, write } }, fn)` sets the globs every agent step
  inside may read and write; a missing side is unrestricted, `[]` allows
  nothing, and `read`/`write` are independent. A nested scope inherits its
  parent's access and replaces it wholesale when it sets its own. A top-level
  `.gtdrc` `access:` key is a scope's FULL name and replaces that scope's
  access wholesale. `gtd land` refuses a turn that changed a path outside the
  step's `write` globs. `agent()` takes no `access` option.

  Scenario: a scope's access rides on the wire with the steering file folded in
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { scope, agent } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", access: { read: ["docs/**"], write: ["out/**"] } }, () =>
          agent("doing", "do the work", { file: ".gtd/NOTES.md", allowEmpty: true }),
        )
      }
      """
    When I run gtd next with "--json=access"
    Then it succeeds
    And stdout contains "\"read\":[\"docs/**\",\".gtd/NOTES.md\"]"
    And stdout contains "\"write\":[\"out/**\",\".gtd/NOTES.md\"]"

  Scenario: an unrestricted turn carries null on both sides and an untouched prompt
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("doing", "do the work", { allowEmpty: true })
      }
      """
    When I run gtd next with "--json=access"
    Then it succeeds
    And stdout contains "\"read\":null"
    And stdout contains "\"write\":null"
    When I run gtd next
    Then it succeeds
    And stdout does not contain "This turn may"

  Scenario: write does not imply read
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { scope, agent } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", access: { read: ["docs/**"], write: ["src/**"] } }, () =>
          agent("doing", "do the work", { allowEmpty: true }),
        )
      }
      """
    When I run gtd next with "--json=access.read"
    Then it succeeds
    And stdout contains "docs/**"
    And stdout does not contain "src/**"

  Scenario: an unrestricted side prints nothing for its selector
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { scope, agent } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", access: { write: ["src/**"] } }, () =>
          agent("doing", "do the work", { allowEmpty: true }),
        )
      }
      """
    When I run gtd next with "--json=access.read"
    Then it succeeds
    And stdout does not contain "null"

  Scenario: the prompt names a restricted turn's globs
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { scope } from "@pmelab/gtd/flows"
      import { agentWithSkills } from "@pmelab/gtd/workflow"

      export default async () => {
        await scope({ name: "work", access: { read: ["docs/**"], write: ["out/**"] } }, () =>
          agentWithSkills("doing", "do the work", { file: ".gtd/NOTES.md", allowEmpty: true }),
        )
      }
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "- This turn may read only: docs/**, .gtd/NOTES.md"
    And stdout contains "- This turn may write only: out/**, .gtd/NOTES.md — anything else is refused when the turn lands"

  Scenario: a nested scope inherits its parent's access
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "outer", access: { write: ["parent/**"] } }, () =>
          scope("inner", () => agent("doing", "do the work", { allowEmpty: true })),
        )
      }
      """
    When I run gtd next with "--json=access.write"
    Then it succeeds
    And stdout contains "parent/**"

  Scenario: a nested scope with its own access replaces the parent's wholesale
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "outer", access: { write: ["parent/**"] } }, () =>
          scope({ name: "inner", access: { read: ["child/**"] } }, () =>
            agent("doing", "do the work", { allowEmpty: true }),
          ),
        )
      }
      """
    When I run gtd next with "--json=access"
    Then it succeeds
    And stdout contains "child/**"
    And stdout does not contain "parent/**"
    And stdout contains "\"write\":null"

  Scenario: an empty access in a nested scope reopens what its parent restricted
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "outer", access: { write: [] } }, () =>
          scope({ name: "inner", access: {} }, () =>
            agent("doing", "do the work", { allowEmpty: true }),
          ),
        )
      }
      """
    When I run gtd next with "--json=access"
    Then it succeeds
    And stdout contains "\"read\":null"
    And stdout contains "\"write\":null"

  Scenario: two agent steps in one memory scope with different access fail the process
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "mixed", access: { write: ["a/**"] } }, () =>
          agent("first", "one", { allowEmpty: true }),
        )
        await scope({ name: "mixed", access: { write: ["b/**"] } }, () =>
          agent("second", "two", { allowEmpty: true }),
        )
      }
      """
    When I run gtd land
    Then it fails
    And stderr contains "runs with a different model, system prompt, skills or file access"

  Scenario: an agent() access option fails as an unknown agent() option
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("doing", "do the work", { access: { write: [] }, allowEmpty: true })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "unknown key(s) access in agent() options"

  Scenario: a malformed scope access fails the process naming the scope
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", access: { write: "src/**" } }, () =>
          agent("doing", "do the work", { allowEmpty: true }),
        )
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "scope \"work\""

  Scenario: a .gtdrc entry replaces the declared access wholesale and reaches nested scopes
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export const access = { outer: { write: ["bundled/**"] } }

      export default async () => {
        await scope({ name: "outer", access: { write: ["declared/**"] } }, () =>
          scope("inner", () => agent("doing", "do the work", { allowEmpty: true })),
        )
      }
      """
    And a gtd config file at ".gtdrc" with:
      """
      access:
        outer:
          read: [docs/**]
      """
    When I run gtd next with "--json=access"
    Then it succeeds
    And stdout contains "docs/**"
    And stdout does not contain "declared/**"
    And stdout does not contain "bundled/**"
    And stdout contains "\"write\":null"

  Scenario: an access key naming no scope that runs a turn is a load error listing the known scopes
    Given a test project
    And the workflow
    And a gtd config file at ".gtdrc" with:
      """
      access:
        no.such.scope:
          write: []
      """
    When I run gtd next
    Then it fails
    And stderr contains "\"access.no.such.scope\" is not a scope that runs a turn"
    And stderr contains "build.review"

  Scenario: a malformed access value is a load error
    Given a test project
    And the workflow
    And a gtd config file at ".gtdrc" with:
      """
      access:
        build.review:
          write: src/**
      """
    When I run gtd next
    Then it fails
    And stderr contains "access.write must be an array of glob strings"

  Scenario: a .gtdrc edit takes effect mid-process, as skills do
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, human } from "@pmelab/gtd/flows"

      export const access = { work: { write: ["one/**"] } }

      export default async () => {
        await scope("work", () => agent("doing", "do the work", { allowEmpty: true }))
        await human("done")
      }
      """
    When I run gtd next with "--json=access.write"
    Then it succeeds
    And stdout contains "one/**"
    Given a gtd config file at ".gtdrc" with:
      """
      access:
        work:
          write: [two/**]
      """
    When I run gtd next with "--json=access.write"
    Then it succeeds
    And stdout contains "two/**"
    And stdout does not contain "one/**"

  Scenario: a write inside the write globs lands
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, human } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", access: { write: ["out/**"] } }, () =>
          agent("doing", "do the work"),
        )
        await human("done")
      }
      """
    And a file "out/result.txt" with:
      """
      done
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): work.doing → done"

  Scenario: the steering file is writable even when write is empty
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, human } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", access: { write: [] } }, () =>
          agent("doing", "do the work", { file: ".gtd/NOTES.md" }),
        )
        await human("done")
      }
      """
    And a file ".gtd/NOTES.md" with:
      """
      notes
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): work.doing → done"

  Scenario: a write outside the write globs refuses the landing and names the paths
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, human } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", access: { write: ["out/**"] } }, () =>
          agent("doing", "do the work"),
        )
        await human("done")
      }
      """
    And a file "out/result.txt" with:
      """
      fine
      """
    And a file "src/foo.ts" with:
      """
      export const foo = 1
      """
    And I record the commit count
    When I run gtd land
    Then it fails
    And stderr contains "gtd land: this turn wrote outside its write access — revert these paths, then run `gtd land` again:"
    And stderr contains "  - src/foo.ts"
    And stderr does not contain "  - out/result.txt"
    And stderr contains "allowed: out/**"
    And the commit count is unchanged
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"work.doing\""
    And stdout contains "\"next\":null"

  Scenario: reverting the offending paths lets the landing through
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, human } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", access: { write: ["out/**"] } }, () =>
          agent("doing", "do the work"),
        )
        await human("done")
      }
      """
    And a file "out/result.txt" with:
      """
      fine
      """
    And a file "src/foo.ts" with:
      """
      export const foo = 1
      """
    When I run gtd land
    Then it fails
    Given the file "src/foo.ts" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): work.doing → done"

  Scenario: a delete outside the write globs is refused too
    Given a test project
    And a file "src/keep.ts" with:
      """
      export const keep = 1
      """
    And the working tree is committed
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, human } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", access: { write: ["out/**"] } }, () =>
          agent("doing", "do the work"),
        )
        await human("done")
      }
      """
    And the working tree is committed
    And the file "src/keep.ts" is deleted
    When I run gtd land
    Then it fails
    And stderr contains "  - src/keep.ts"

  Scenario: a bundled review lens that writes src/ is refused at landing
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to "owasp-security"
    And gtd starts workflow "fix"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality.owasp-security.reviewing"
    When I run gtd next with "--json=access.write"
    Then it succeeds
    And stdout contains ".gtd/QUALITY.md"
    And stdout does not contain "src/"
    When I run gtd next
    Then it succeeds
    And stdout contains "- This turn may write only: .gtd/QUALITY.md — anything else is refused when the turn lands"
    Given "src/thing.ts" is modified to:
      """
      export const thing = 2
      """
    When I run gtd land
    Then it fails
    And stderr contains "  - src/thing.ts"
    And stderr contains "allowed: .gtd/QUALITY.md"
    Given "src/thing.ts" is modified to:
      """
      export const thing = 1
      """
    When I run gtd land
    Then it succeeds

  Scenario: a bundled review turn answering a code thread in src/ lands with the file on the wire
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    And "src/calc.ts" is modified to:
      """
      // H: why not multiply?
      export const add = (a: number, b: number) => a + b
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    When I run gtd next with "--json=access.write"
    Then it succeeds
    And stdout contains "src/calc.ts"
    And stdout contains ".gtd/REQUIREMENTS.md"
    Given "src/calc.ts" is modified to:
      """
      // H: why not multiply?
      // A: this is the addition helper.
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → build.review.await-review"
