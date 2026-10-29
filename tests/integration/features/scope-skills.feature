@inmem
Feature: skills are declared per scope

  `scope({ name, skills }, fn)` sets the skill list every agent step inside
  runs with. A nested scope inherits its parent's list and replaces it
  wholesale when it sets its own; two agent steps in one memory scope with
  different lists fail the process. A `config.skills` key in `gtd.config.ts` is a
  scope's FULL name and replaces that scope's list wholesale (`[]` means
  none). A key that is not a scope running a turn is a load error listing the
  known scopes. `agent()` takes no `skills` option.

  Scenario: a scope's skills ride on the wire
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "work", skills: ["skill-one", "skill-two"] }, () =>
          agent("doing", "do the work", { allowEmpty: true }),
        )
      }
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"skill-one\""
    And stdout contains "\"skill-two\""

  Scenario: a nested scope inherits its parent's list
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "outer", skills: ["parent-skill"] }, () =>
          scope("inner", () => agent("doing", "do the work", { allowEmpty: true })),
        )
      }
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"parent-skill\""

  Scenario: a nested scope with its own list replaces the parent's wholesale
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "outer", skills: ["parent-skill"] }, () =>
          scope({ name: "inner", skills: ["child-skill"] }, () =>
            agent("doing", "do the work", { allowEmpty: true }),
          ),
        )
      }
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"child-skill\""
    And stdout does not contain "parent-skill"

  Scenario: a parent config entry reaches a nested scope that sets no list
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, workflow } from "@pmelab/gtd/flows"

      const skills = { outer: ["bundled"], "outer.inner": ["bundled-inner"] }

      export default workflow(async () => {
        await scope({ name: "outer", skills: ["parent-skill"] }, () =>
          scope("deeper", () => agent("doing", "do the work", { allowEmpty: true })),
        )
      }, { skills })

      export const config = {
        skills: {
          outer: ["rc-skill"],
        },
      }
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"rc-skill\""
    And stdout does not contain "parent-skill"

  Scenario: a config entry on a parent does not reach a nested scope with its own list
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, workflow } from "@pmelab/gtd/flows"

      const skills = { outer: ["bundled"], "outer.inner": ["bundled-inner"] }

      export default workflow(async () => {
        await scope("outer", () =>
          scope({ name: "inner", skills: ["child-skill"] }, () =>
            agent("doing", "do the work", { allowEmpty: true }),
          ),
        )
      }, { skills })

      export const config = {
        skills: {
          outer: ["rc-skill"],
        },
      }
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"child-skill\""
    And stdout does not contain "rc-skill"

  Scenario: two scope() calls of one memory scope with different lists are two conversations and land
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await scope({ name: "mixed", skills: ["first-skill"] }, () =>
          agent("first", "one", { allowEmpty: true }),
        )
        await scope({ name: "mixed", skills: ["other-skill"] }, () =>
          agent("second", "two", { allowEmpty: true }),
        )
      }
      """
    When I run gtd land
    Then it succeeds

  Scenario: an agent() skills option fails as an unknown agent() option
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("doing", "do the work", { skills: ["own"], allowEmpty: true })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "unknown key(s) skills in agent() options"

  Scenario: an unknown key exits 1 and lists the known scopes
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
        skills: {
          "no.such.scope": ["whatever"],
        },
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "\"skills.no.such.scope\" is not a scope that runs a turn"
    And stderr contains "design"
    And stderr contains "build.review"

  Scenario: an empty array empties gtd next --json's skills
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, workflow } from "@pmelab/gtd/flows"

      const skills = { idle: ["a-default-skill"] }

      export default workflow(async () => {
        await scope({ name: "idle", skills: ["a-default-skill"] }, () =>
          agent("doing", "do the work", { allowEmpty: true }),
        )
      }, { skills })

      export const config = {
        skills: {
          idle: [],
        },
      }
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "\"skills\""

  Scenario: a gtd.config.ts skills export is addressable by a config scope key
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope, workflow } from "@pmelab/gtd/flows"

      const skills = { custom: ["bundled-default"] }

      export default workflow(async () => {
        await scope("custom", () => agent("doing", "do the custom work", { allowEmpty: true }))
      }, { skills })
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"bundled-default\""
    Given the file "gtd.config.ts" ends with:
      """
      export const config = { skills: { custom: ["my-org-skill"] } }
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"my-org-skill\""
    And stdout does not contain "bundled-default"

  Scenario: a scope key a pinned var adds stays valid after the env that set it is gone
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, scope, settings, workflow } from "@pmelab/gtd/flows"

      const defaults = { lenses: "" }
      const skills = (v) => ({
        work: [],
        ...Object.fromEntries(
          (v.lenses ?? "")
            .split(",")
            .map((l) => l.trim())
            .filter((l) => l !== "")
            .map((l) => [`work.${l}`, []]),
        ),
      })

      export default workflow(async () => {
        await human("idle", { message: "nothing to do" })
      }, { defaults, skills })

      export const review = workflow(async () => {
        for (const lens of (settings.lenses ?? "").split(",").map((l) => l.trim()).filter((l) => l !== ""))
          await scope("work", () => scope(lens, () => agent("reviewing", "review it", { allowEmpty: true })))
      }, { defaults, skills })

      export const config = {
        skills: {
          "work.my-lens": ["my-org-checklist"],
        },
      }
      """
    And an environment variable "GTD_LENSES" set to "my-lens"
    When I run gtd with args "start review"
    Then it succeeds
    And the last commit subject is "gtd(human): work.my-lens.reviewing"
    Given the environment variable "GTD_LENSES" is unset
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"my-org-checklist\""
    And stderr does not contain "is not a scope that runs a turn"

  Scenario: a scope key a --var adds stays valid for the rest of the process
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, scope, settings, workflow } from "@pmelab/gtd/flows"

      const defaults = { lenses: "" }
      const skills = (v) => ({
        work: [],
        ...Object.fromEntries(
          (v.lenses ?? "")
            .split(",")
            .map((l) => l.trim())
            .filter((l) => l !== "")
            .map((l) => [`work.${l}`, []]),
        ),
      })

      export default workflow(async () => {
        await human("idle", { message: "nothing to do" })
      }, { defaults, skills })

      export const review = workflow(async () => {
        for (const lens of (settings.lenses ?? "").split(",").map((l) => l.trim()).filter((l) => l !== ""))
          await scope("work", () => scope(lens, () => agent("reviewing", "review it", { allowEmpty: true })))
      }, { defaults, skills })

      export const config = {
        skills: {
          "work.my-lens": ["my-org-checklist"],
        },
      }
      """
    When I run gtd with args "start review --var lenses=my-lens"
    Then it succeeds
    And the last commit subject is "gtd(human): work.my-lens.reviewing"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"my-org-checklist\""
    And stderr does not contain "is not a scope that runs a turn"
