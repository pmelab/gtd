# One SDLC path per file, so a changed path reds exactly one fixture — do not merge.
@inmem
Feature: cleanup walks one fixed path from the opening commit to idle

  A default-on release flag is cleaned up by an agent that removes the registry
  entry and the off path; health, review and closing follow and the process
  rests at idle. Cleanup reads no release flag, so no flag is pinned here and
  every flag state takes the same path.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And a gtd config with:
      """
      export {
        feature as default,
        feature,
        defaults,
        envDefaults,
        summary,
        steering,
        skills,
        access,
      } from "@pmelab/gtd/workflows/feature"
      import { cleanup } from "@pmelab/gtd/workflows"
      export { cleanup }
      """
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And a file "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And a file "src/calc.ts" with:
      """
      export const on = process.env.GTD_FLAG_LIVE !== "0"
      """
    And the working tree is committed as "feat: registry"
    And step "cleanup.removing" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release" },
      ] as const
      """
    And step "cleanup.removing" writes "src/calc.ts" with:
      """
      export const on = true
      """
    And step "build.health.check" changes nothing
    And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        flag removed
      """
    And step "build.review.closing" runs its script

  Scenario: removing the entry and the off path runs health, review and closing to idle
    When gtd starts workflow "cleanup" with "--var flag=live"
    And the process is driven
    Then the process rests at "build.review.await-review"
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [x] ./src/calc.ts#1-1
        flag removed
      """
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And "src/flags/index.ts" does not contain "live"
    And "src/calc.ts" does not contain "GTD_FLAG_LIVE"
    And the commit subjects end with:
      """
      gtd(human): cleanup.removing
      gtd(agent): cleanup.removing → build.health.check
      gtd(check): build.health.check → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.await-review
      gtd(human): build.review.await-review → build.review.closing
      gtd(check): build.review.closing → idle
      """
    And the commit "gtd(human): cleanup.removing" has a body containing "Gtd-Workflow: cleanup"
    And the commit "gtd(human): cleanup.removing" has a body containing "Gtd-Var: flag=live"
