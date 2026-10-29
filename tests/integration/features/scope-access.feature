@inmem
Feature: file access is declared per scope

  `scope({ name, access: { read, write } }, fn)` sets the globs every agent step
  inside may read and write; a missing side is unrestricted, `[]` allows
  nothing, and `read`/`write` are independent. A nested scope inherits its
  parent's access and replaces it wholesale when it sets its own. A
  `config.access` key in `gtd.config.ts` is a scope's FULL name and replaces that scope's
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

  Scenario: an unrestricted turn carries null on both sides
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

  Scenario: two scope() calls of one memory scope with different access are two conversations and land
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
    Then it succeeds

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

  Scenario: a config entry replaces the declared access wholesale and reaches nested scopes
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, workflow } from "@pmelab/gtd/flows"

      const access = { outer: { write: ["bundled/**"] } }

      export default workflow(async () => {
        await scope({ name: "outer", access: { write: ["declared/**"] } }, () =>
          scope("inner", () => agent("doing", "do the work", { allowEmpty: true })),
        )
      }, { access })

      export const config = {
        access: {
          outer: {
            read: ["docs/**"],
          },
        },
      }
      """
    When I run gtd next with "--json=access"
    Then it succeeds
    And stdout contains "docs/**"
    And stdout does not contain "declared/**"
    And stdout does not contain "bundled/**"
    And stdout contains "\"write\":null"

  Scenario: an access key naming no scope that runs a turn is a load error listing the known scopes
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, workflow } from "@pmelab/gtd/flows"

      const skills = { design: [], "build.review": [] }

      export default workflow(async () => {
        await scope("design", () => agent("triage", "design it", { allowEmpty: true }))
        await scope("build", () =>
          scope("review", () => agent("reviewing", "review it", { allowEmpty: true })),
        )
      }, { skills })

      export const config = {
        access: {
          "no.such.scope": {
            write: [],
          },
        },
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "\"access.no.such.scope\" is not a scope that runs a turn"
    And stderr contains "build.review"

  Scenario: a malformed access value is a load error
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, workflow } from "@pmelab/gtd/flows"

      const skills = { design: [], "build.review": [] }

      export default workflow(async () => {
        await scope("design", () => agent("triage", "design it", { allowEmpty: true }))
        await scope("build", () =>
          scope("review", () => agent("reviewing", "review it", { allowEmpty: true })),
        )
      }, { skills })

      export const config = {
        access: {
          "build.review": {
            write: "src/**",
          },
        },
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "config.access.build.review.write: must be an array of glob strings"

  Scenario: a config edit takes effect mid-process, as skills do
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, human, workflow } from "@pmelab/gtd/flows"

      const access = { work: { write: ["one/**"] } }

      export default workflow(async () => {
        await scope("work", () => agent("doing", "do the work", { allowEmpty: true }))
        await human("done")
      }, { access })
      """
    When I run gtd next with "--json=access.write"
    Then it succeeds
    And stdout contains "one/**"
    Given the file "gtd.config.ts" ends with:
      """
      export const config = { access: { work: { write: ["two/**"] } } }
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
