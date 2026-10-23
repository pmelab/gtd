@inmem
Feature: a gtd.config.ts builds on the shipped workflows through @pmelab/gtd/workflows

  `@pmelab/gtd/workflows` is gtd's shipped workflows as a module: its default
  export (`feature`) is the ordinary start, and its phases, steps, `defaults`,
  `summary`, `base`, `steering` and `skills` are named exports. A
  workflow of its own can re-export what it keeps and compose the rest, and the
  steps it reuses keep their full names — `skills` included, since dropping it
  from the re-export list the way dropping any other named export does
  silently empties every reused step's skill list instead of keeping the
  shipped defaults.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { start } from "@pmelab/gtd/flows"
      import { afterTail, buildTail } from "@pmelab/gtd/workflows"

      export { feature as default, defaults, envDefaults, summary, base, steering, skills } from "@pmelab/gtd/workflows"

      export const hotfix = async () => afterTail(await buildTail(start(), { fixFirst: true }))
      """

  Scenario: an ordinary start runs the shipped flow, resting at its idle step
    When I run gtd next
    Then it succeeds
    And stdout contains "No active gtd process"

  Scenario: a new named workflow reuses the shipped build tail, whose steps keep their full names
    When I run gtd with args "--workflow hotfix"
    Then it succeeds
    And the last commit subject is "gtd(human): build.fix"
    Given a file "src/fix.ts" with:
      """
      export const fixed = true
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"

  Scenario: the shipped defaults are the reusing workflow's own
    When I run gtd with args "--workflow hotfix --var judgeBudgetBytes=65536"
    Then it succeeds
    And the last commit subject is "gtd(human): build.fix"
    And the last commit body contains "Gtd-Var: judgeBudgetBytes=65536"

  Scenario: the re-exported skills export keeps scope build's shipped skill list — the re-export, not a literal, is what resolves it here
    When I run gtd with args "--workflow hotfix"
    Then it succeeds
    And the last commit subject is "gtd(human): build.fix"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"debugging-and-error-recovery\""

  Scenario: a config skills entry addresses scope build through the re-exported skills, the same as it would in the shipped workflow itself
    Given the file "gtd.config.ts" ends with:
      """
      export const config = { skills: { build: ["my-org-runbook"] } }
      """
    When I run gtd with args "--workflow hotfix"
    Then it succeeds
    And the last commit subject is "gtd(human): build.fix"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "\"my-org-runbook\""
    And stdout does not contain "debugging-and-error-recovery"

  Scenario: afterTail's feedback lap is design → implement, never the seam
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { start } from "@pmelab/gtd/flows"
      import { afterTail, buildTail, gate } from "@pmelab/gtd/workflows"

      export { feature as default, defaults, envDefaults, summary, base, steering, skills, access } from "@pmelab/gtd/workflows"

      export async function review() {
        await gate("review-gate", "The baseline is red.")
        return afterTail(await buildTail(start()))
      }
      """
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
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^a][^b]

      [^a]:
          - H: add subtract too.

      [^b]:
          - H: why not multiply?
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Subtract

      Export `subtract()`.

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function[^b]

      [^b]:
          - H: why not multiply?
          - A: this is the addition helper.
      """
    And gtd lands "gtd(agent): build.review.collecting → build.review.await-review"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1
      new add function — looks good
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.triage"
    When I run gtd judge answer with stdin:
      """
      [{"id": "note-1", "answer": "praise", "p": 0.99}]
      """
    Then it succeeds
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → re-unwind"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → design.triage"
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      - subtract

      ## Impact

      - the greeting module

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → implement.building"
    And the git log does not contain "seam.naive"
    And the git log does not contain "seam.judge"
