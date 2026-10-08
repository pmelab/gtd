@inmem
Feature: the per-step "skills:" key

  A top-level `.gtdrc` `skills:` key, keyed by a step's FULL name, replaces
  the nine deleted `*Skills` workflow vars: each entry REPLACES the named
  step's bundled skill list wholesale, never adds to it. The valid keys come
  from the workflow in play, not a fixed set — a custom `gtd.config.ts`'s own
  `skills` export is addressable the same way. A key naming a step the
  workflow does not declare is a load error, exit 1, listing the known
  names. The nine deleted `*Skills` var names are rejected the same way when
  set under `.gtdrc` `vars:`, each naming its replacement step key(s); the
  `GTD_*SKILLS` environment override those vars used to carry is simply gone
  — nothing reads it, so it produces neither an error nor a warning.

  Scenario: packages.item.fix-suite and build.fix — the pair that shared the deleted fixSkills var — now configure independently
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export const skills = { "packages.item.fix-suite": [], "build.fix": [] }

      export default async () => {
        await scope("packages", () =>
          scope("item", () => agent("fix-suite", "fix the suite", { allowEmpty: true })),
        )
        await scope("build", () => agent("fix", "fix the build", { allowEmpty: true }))
      }
      """
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        packages.item.fix-suite: [skill-one]
        build.fix: [skill-two]
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"skill-one\""
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.fix-suite → build.fix"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"skill-two\""

  Scenario: build.review.reviewing and build.review.collecting — the pair that shared the deleted reviewSkills var — now configure independently
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, scope } from "@pmelab/gtd/flows"

      export const skills = { "build.review.reviewing": [], "build.review.collecting": [] }

      export default async () => {
        await scope("build", () =>
          scope("review", async () => {
            await agent("reviewing", "review the change", { allowEmpty: true })
            await agent("collecting", "collect the feedback", { allowEmpty: true })
          }),
        )
      }
      """
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        build.review.reviewing: [skill-one]
        build.review.collecting: [skill-two]
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"skill-one\""
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.reviewing → build.review.collecting"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"skill-two\""

  Scenario: an entry naming a step the workflow does not declare exits 1, listing the known names
    Given a test project
    And the workflow
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        no.such.step: [whatever]
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "\"skills.no.such.step\" names a step this workflow does not declare"
    And stderr contains "design.triage"
    And stderr contains "build.review.collecting"

  Scenario: an empty array empties gtd next --json's skills and drops the preamble
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export const skills = { idle: ["a-default-skill"] }

      export default async () => {
        await agent("idle", "do the work", { allowEmpty: true })
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
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout is empty

    # --json=skills alone can't tell an absent field from a present-but-empty
    # one — selectPath renders both as "". The full --json object can: the
    # key itself must be gone, not just empty, per Task 3's "no wire skills
    # field at all".
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "\"skills\""

  Scenario: a gtd.config.ts declaring its own skills export, with a .gtdrc addressing one of its own steps
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export const skills = { "custom.step": ["bundled-default"] }

      export default async () => {
        await agent("custom.step", "do the custom work", { allowEmpty: true })
      }
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"bundled-default\""

    Given a gtd config file at ".gtdrc" with:
      """
      skills:
        custom.step: [my-org-skill]
      """
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"my-org-skill\""
    And stdout does not contain "bundled-default"

  Scenario: a ".gtdrc" "vars:" setting "buildSkills" exits 1, naming packages.item.building
    Given a test project
    And the workflow
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        buildSkills: my-org-tdd-skill
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "\"vars.buildSkills\" was removed"
    And stderr contains "packages.item.building"

  Scenario: a set GTD_BUILDSKILLS with a clean .gtdrc runs to completion on the bundled skills, with no diagnostic at all
    Given a test project
    And the workflow
    And an environment variable "GTD_BUILDSKILLS" set to "my-org-tdd-skill"
    When I run gtd next
    Then it succeeds
    And stderr does not contain "gtd config:"
    And stderr does not contain "buildSkills"

  Scenario: a build.quality.reviewing entry replaces the lens on every quality turn, while qualityReviews still sets how many turns run
    Given a test project
    And the workflow
    And a gtd config file at ".gtdrc" with:
      """
      skills:
        build.quality.reviewing: [my-org-checklist]
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
    And the last commit subject is "gtd(check): build.health.check → build.quality.reviewing"

    # Two turns run (qualityReviews still sets the count) but BOTH carry the
    # configured entry's skill in the preamble, and the body still names
    # each turn's own lens — what makes the two otherwise-identical prompts
    # distinguishable.
    When I run gtd next
    Then it succeeds
    And stdout contains "my-org-checklist"
    And stdout contains "`owasp-security`"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"my-org-checklist\""

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "my-org-checklist"
    And stdout contains "`ponytail-review`"

  Scenario: with no build.quality.reviewing entry, a quality turn's own skill is the lens itself — on the wire AND in the preamble, never one without the other
    Given a test project
    And the workflow
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
    And the last commit subject is "gtd(check): build.health.check → build.quality.reviewing"

    # build.quality.reviewing has no bundled default of its own, so the
    # preamble falls back to naming the turn's own skill (the lens) — the
    # same list the wire's skills field carries, never one without the
    # other.
    When I run gtd next
    Then it succeeds
    And stdout contains "missing one: code-review-and-quality"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"code-review-and-quality\""
