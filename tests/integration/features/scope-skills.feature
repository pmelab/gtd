@inmem
Feature: skills are declared per scope

  `scope({ name, skills }, fn)` sets the skill list every agent step inside
  runs with. A nested scope inherits its parent's list and replaces it
  wholesale when it sets its own; two agent steps in one memory scope with
  different lists fail the process. A top-level `.gtdrc` `skills:` key is a
  scope's FULL name and replaces that scope's list wholesale (`[]` means
  none). A key that is not a scope running a turn is a load error listing the
  known scopes. `agent()` takes no `skills` option.

  Scenario: a scope's skills ride on the wire and in the preamble
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { scope } from "@pmelab/gtd/flows"
      import { agentWithSkills } from "@pmelab/gtd/workflow"

      export default async () => {
        await scope({ name: "work", skills: ["skill-one", "skill-two"] }, () =>
          agentWithSkills("doing", "do the work", { allowEmpty: true }),
        )
      }
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"skill-one\""
    And stdout contains "\"skill-two\""
    When I run gtd next
    Then it succeeds
    And stdout contains "missing one: skill-one, skill-two"

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

  Scenario: a parent .gtdrc entry reaches a nested scope that sets no list
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export const skills = { outer: ["bundled"], "outer.inner": ["bundled-inner"] }

      export default async () => {
        await scope({ name: "outer", skills: ["parent-skill"] }, () =>
          scope("deeper", () => agent("doing", "do the work", { allowEmpty: true })),
        )
      }
      """
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        outer: [rc-skill]
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"rc-skill\""
    And stdout does not contain "parent-skill"

  Scenario: a .gtdrc entry on a parent does not reach a nested scope with its own list
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export const skills = { outer: ["bundled"], "outer.inner": ["bundled-inner"] }

      export default async () => {
        await scope("outer", () =>
          scope({ name: "inner", skills: ["child-skill"] }, () =>
            agent("doing", "do the work", { allowEmpty: true }),
          ),
        )
      }
      """
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        outer: [rc-skill]
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"child-skill\""
    And stdout does not contain "rc-skill"

  Scenario: two agent steps in one memory scope with different lists fail the process
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
    Then it fails
    And stderr contains "runs with a different model, system prompt, skills or file access"

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
    And the workflow
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        no.such.scope: [whatever]
      """
    When I run gtd next
    Then it fails
    And stderr contains "\"skills.no.such.scope\" is not a scope that runs a turn"
    And stderr contains "design"
    And stderr contains "build.review"

  Scenario: an empty array empties gtd next --json's skills and drops the preamble
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export const skills = { idle: ["a-default-skill"] }

      export default async () => {
        await scope({ name: "idle", skills: ["a-default-skill"] }, () =>
          agent("doing", "do the work", { allowEmpty: true }),
        )
      }
      """
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        idle: []
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Load whatever's listed here"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "\"skills\""

  Scenario: a gtd.config.ts skills export is addressable by a .gtdrc scope key
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export const skills = { custom: ["bundled-default"] }

      export default async () => {
        await scope("custom", () => agent("doing", "do the custom work", { allowEmpty: true }))
      }
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"bundled-default\""

    Given a gtd config file at ".gtdrc" with:
      """
      skills:
        custom: [my-org-skill]
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"my-org-skill\""
    And stdout does not contain "bundled-default"

  Scenario: a build.quality.<lens> entry replaces that lens's skills only
    Given a test project
    And the workflow
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        build.quality.owasp-security: [my-org-checklist]
      """
    And an environment variable "GTD_QUALITYREVIEWS" set to "owasp-security, ponytail-review"
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

    When I run gtd next
    Then it succeeds
    And stdout contains "missing one: my-org-checklist"
    And stdout contains "`owasp-security`"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"my-org-checklist\""

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.owasp-security.reviewing → build.quality.ponytail-review.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "missing one: ponytail-review"
    And stdout does not contain "my-org-checklist"

  Scenario: a lens pinned from GTD_QUALITYREVIEWS at entry stays valid after the env is gone
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to "my-lens"
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        build.quality.my-lens: [my-org-checklist]
      """
    And gtd starts workflow "fix"
    And the environment variable "GTD_QUALITYREVIEWS" is unset
    When I run gtd next
    Then it succeeds
    And stderr does not contain "is not a scope that runs a turn"

  Scenario: a lens pinned from --var at entry stays valid for the rest of the process
    Given a test project
    And the workflow
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        build.quality.my-lens: [my-org-checklist]
      """
    When I run gtd with args "--workflow fix --var qualityReviews=my-lens"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-precheck"
    When I run gtd next
    Then it succeeds
    And stderr does not contain "is not a scope that runs a turn"
