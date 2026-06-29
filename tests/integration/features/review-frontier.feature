Feature: Review frontier — gtd-workflow commits above a closed review

  # Regression: gtd-workflow commits (plan, chore, etc.) landing on top of a
  # close commit must not re-open a review. The frontier short-circuit must
  # treat them as non-reviewable and stay in the verified/healthy state.

  Scenario: Plan commit on top of a close does not re-open review
    Given a test project
    And a commit "feat(gtd): add foo helper" that adds "src/foo.ts" with:
      """
      export function foo() {}
      """
    And a prior close commit for "abc1234"
    And a commit "plan(gtd): grilling" that adds "TODO.md" with:
      """
      # Plan

      - [ ] Implement bar helper
      """
    When I run gtd
    Then it succeeds
    And stdout contains "working tree healthy and fully reviewed"
    And the file "REVIEW.md" does not exist

  Scenario: Real code commit on top of a close re-opens review
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      agenticReview: false
      """
    And a prior close commit for "abc1234"
    And a commit "feat: real change" that adds "src/real.ts" with:
      """
      export function real() {}
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Generate REVIEW.md after successful verification"

  Scenario: Plan commit then real code on top of a close still re-opens review
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      agenticReview: false
      """
    And a prior close commit for "abc1234"
    And a commit "plan(gtd): grilling" that adds "TODO.md" with:
      """
      # Plan

      - [ ] Implement real helper
      """
    And a commit "feat: real change" that adds "src/real.ts" with:
      """
      export function real() {}
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Generate REVIEW.md after successful verification"
