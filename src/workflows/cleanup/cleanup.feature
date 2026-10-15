Feature: cleanup removes a default-on release flag and keeps its flag-on path

  `gtd --workflow cleanup --var flag=<name>` has an agent delete the registry
  entry and the off path; checks refuse a surviving entry or env-var reference,
  then the shared health loop and review run. A review note ends the process.

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
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And a file "src/calc.ts" with:
      """
      export const on = process.env.GTD_FLAG_LIVE !== "0"
      """
    And the working tree is committed as "feat: registry"

  Scenario: removing the entry and the off path lands, then reaches the review gate
    Given step "cleanup.removing" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
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
    When gtd starts workflow "cleanup" with "--var flag=live"
    And the process is driven
    Then the process rests at "build.review.await-review"
    And "src/flags/index.ts" does not contain "live"

  Scenario: a turn leaving the registry entry is refused
    Given step "cleanup.removing" writes "src/calc.ts" with:
      """
      export const on = true
      """
    When gtd starts workflow "cleanup" with "--var flag=live"
    Then driving the process is refused with "src/flags/index.ts still declares flag \"live\""

  Scenario: a turn leaving the env var in a shipped source is refused naming path:line
    Given step "cleanup.removing" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release" },
      ] as const
      """
    When gtd starts workflow "cleanup" with "--var flag=live"
    Then driving the process is refused with "src/calc.ts:1 still names GTD_FLAG_LIVE"

  Scenario: the same env var in a test file is allowed
    Given a file "src/calc.test.ts" with:
      """
      process.env.GTD_FLAG_LIVE = "0"
      """
    And the working tree is committed as "test: pin kill switch"
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
    When gtd starts workflow "cleanup" with "--var flag=live"
    And the process is driven
    Then the process rests at "build.review.reviewing"

  Scenario: a review note ends the process leaving the review for fix
    Given step "cleanup.removing" writes "src/flags/index.ts" with:
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
    When gtd starts workflow "cleanup" with "--var flag=live"
    And the process is driven
    Then the process rests at "build.review.await-review"

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-1
        flag removed — also drop the constant
      """
    And step "build.review.handing-off" runs its script
    When gtd lands
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/REVIEW.md" contains "also drop the constant"
    And ".gtd/REVIEW.orig.md" contains "flag removed"

  Scenario: a default-off flag is refused at start
    Then starting workflow "cleanup" with "--var flag=alpha" is refused with "flag \"alpha\" is not default-on — roll it out first"

  Scenario: an unknown flag is refused at start
    Then starting workflow "cleanup" with "--var flag=nope" is refused with "no flag \"nope\" in src/flags/index.ts"

  Scenario: a non-release flag is refused at start
    Then starting workflow "cleanup" with "--var flag=ops1" is refused with "flag \"ops1\" is ops, not release"
