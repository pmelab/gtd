Feature: Illegal steering-file combinations hard-error

  Some steering-file combinations never arise in normal flow. Rather than guess,
  gtd hard-errors before the precedence ladder, exiting non-zero with the offending
  combination on stderr.

  Scenario: ERRORS.md and FEEDBACK.md together hard-error
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file "ERRORS.md" with:
      """
      a failure
      """
    And a file "FEEDBACK.md" with:
      """
      a finding
      """
    And the working tree is committed as "feat: both gates"
    When I run gtd
    Then it fails
    And stderr contains "illegal combination: ERRORS.md + FEEDBACK.md"

  Scenario: FEEDBACK.md without a .gtd directory hard-errors
    Given a test project
    And a commit "feat: stray feedback" that adds "FEEDBACK.md" with:
      """
      a finding with no package to fix
      """
    When I run gtd
    Then it fails
    And stderr contains "illegal combination: FEEDBACK.md without .gtd"

  Scenario: REVIEW.md alongside a .gtd directory hard-errors
    Given a test project
    And a file ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file "REVIEW.md" with:
      """
      # Review
      """
    And the working tree is committed as "feat: review and packages"
    When I run gtd
    Then it fails
    And stderr contains "illegal combination: REVIEW.md + .gtd"
