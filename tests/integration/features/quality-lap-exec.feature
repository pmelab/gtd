@live
Feature: the quality lap's queue steps run for real through gtd exec

  `build.quality.seeding` writes one `.gtd/reviews/NN-<lens>.md` per
  `qualityReviews` entry, and `build.quality.picking` moves the lexically
  first into `.gtd/NEXT_REVIEW.md`; once the queue is empty it writes
  `.gtd/QUALITY_DONE.md`, plus `.gtd/QUALITY_READY.md` when a lens left
  findings in `.gtd/QUALITY.md`. Both are callback steps: `gtd exec` runs them.

  Background:
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to " first-lens , second-lens "
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 failing test
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.quality.seeding"

  Scenario: seeding queues one trimmed, numbered file per lens, and picking takes the first
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/reviews/01-first-lens.md" contains "first-lens"
    And ".gtd/reviews/02-second-lens.md" contains "second-lens"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.seeding → build.quality.picking"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/NEXT_REVIEW.md" contains "first-lens"
    And ".gtd/reviews/01-first-lens.md" does not exist
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.picking → build.quality.reviewing"

  Scenario: draining the queue with findings marks the lap done and ready for fixing
    Given a file ".gtd/reviews/01-first-lens.md" with:
      """
      first-lens
      """
    And gtd lands "gtd(check): build.quality.seeding → build.quality.picking"
    And the file ".gtd/reviews/01-first-lens.md" is deleted
    And a file ".gtd/NEXT_REVIEW.md" with:
      """
      first-lens
      """
    And gtd lands "gtd(check): build.quality.picking → build.quality.reviewing"
    And a file ".gtd/QUALITY.md" with:
      """
      - a blocking finding
      """
    And gtd lands "gtd(agent): build.quality.reviewing → build.quality.picking"
    When I run gtd next with "--json"
    And I execute the printed check script
    Then ".gtd/QUALITY_DONE.md" exists
    And ".gtd/QUALITY_READY.md" exists
    And ".gtd/NEXT_REVIEW.md" does not exist
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.picking → build.fix-quality"
