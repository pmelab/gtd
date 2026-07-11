@inmem
Feature: Illegal steering-file combinations hard-error

  Some steering-file combinations never arise in normal flow. Rather than
  guess, gtd hard-errors before the precedence ladder, exiting non-zero with
  the offending combination on stderr. A committed SQUASH_MSG.md under a
  `gtd: squash template` HEAD is not one of these — it is the legal squashing
  rest, so status succeeds there.

  Scenario: REVIEW.md and a .gtd directory together hard-error
    Given a test project
    And a file ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file ".gtd/REVIEW.md" with:
      """
      # Review
      """
    And the working tree is committed as "feat: review and packages"
    When I run gtd status
    Then it fails
    And stderr contains "illegal combination"
    And stderr contains ".gtd/REVIEW.md"
    And stderr contains ".gtd"

  Scenario: FEEDBACK.md and REVIEW.md together hard-error
    Given a test project
    And a file ".gtd/FEEDBACK.md" with:
      """
      a finding
      """
    And a file ".gtd/REVIEW.md" with:
      """
      # Review
      """
    And the working tree is committed as "feat: feedback and review"
    When I run gtd status
    Then it fails
    And stderr contains "illegal combination"
    And stderr contains ".gtd/FEEDBACK.md"
    And stderr contains ".gtd/REVIEW.md"

  Scenario: FEEDBACK.md without a .gtd directory hard-errors
    Given a test project
    And a commit "feat: stray feedback" that adds ".gtd/FEEDBACK.md" with:
      """
      a finding with no package to fix
      """
    When I run gtd status
    Then it fails
    And stderr contains "illegal combination"
    And stderr contains ".gtd/FEEDBACK.md"

  Scenario: ERRORS.md and FEEDBACK.md together hard-error
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file ".gtd/ERRORS.md" with:
      """
      a failure
      """
    And a file ".gtd/FEEDBACK.md" with:
      """
      a finding
      """
    And the working tree is committed as "feat: both gates"
    When I run gtd status
    Then it fails
    And stderr contains "illegal combination"
    And stderr contains ".gtd/ERRORS.md"
    And stderr contains ".gtd/FEEDBACK.md"

  Scenario: HEALTH.md and a .gtd directory together hard-error
    Given a test project
    And a file ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file ".gtd/HEALTH.md" with:
      """
      a health failure
      """
    And the working tree is committed as "feat: health and packages"
    When I run gtd status
    Then it fails
    And stderr contains "illegal combination"
    And stderr contains ".gtd/HEALTH.md"
    And stderr contains ".gtd"

  Scenario: HEALTH.md and REVIEW.md together hard-error
    Given a test project
    And a file ".gtd/HEALTH.md" with:
      """
      a health failure
      """
    And a file ".gtd/REVIEW.md" with:
      """
      # Review
      """
    And the working tree is committed as "feat: health and review"
    When I run gtd status
    Then it fails
    And stderr contains "illegal combination"
    And stderr contains ".gtd/HEALTH.md"
    And stderr contains ".gtd/REVIEW.md"

  Scenario: HEALTH.md and FEEDBACK.md together hard-error
    Given a test project
    And a file ".gtd/HEALTH.md" with:
      """
      a health failure
      """
    And a file ".gtd/FEEDBACK.md" with:
      """
      a finding
      """
    And the working tree is committed as "feat: health and feedback"
    When I run gtd status
    Then it fails
    And stderr contains "illegal combination"
    And stderr contains ".gtd/HEALTH.md"
    And stderr contains ".gtd/FEEDBACK.md"

  Scenario: HEALTH.md and ERRORS.md together hard-error
    Given a test project
    And a file ".gtd/HEALTH.md" with:
      """
      a health failure
      """
    And a file ".gtd/ERRORS.md" with:
      """
      an escalation
      """
    And the working tree is committed as "feat: health and errors"
    When I run gtd status
    Then it fails
    And stderr contains "illegal combination"
    And stderr contains ".gtd/HEALTH.md"
    And stderr contains ".gtd/ERRORS.md"

  Scenario: A committed SQUASH_MSG.md under gtd: squash template is legal
    Given a test project
    And a commit "gtd: squash template" that adds ".gtd/SQUASH_MSG.md" with:
      """
      feat: add helper
      """
    When I run gtd status
    Then it succeeds
