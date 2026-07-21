@inmem
Feature: Agentic Review — verdict-by-file, with force-approve guards

  A clean rest at `gtd: tests-green` hands the agent a review prompt
  containing the package task text. The reviewer's verdict is FEEDBACK.md, not
  a marker commit: an empty FEEDBACK.md approves and the same
  `gtd(agent): agentic-review` turn closes the package (`gtd: close-package`,
  removing FEEDBACK.md and the `.gtd/` package); a non-empty FEEDBACK.md rests
  after the turn, and `gtd next` emits the fixing prompt containing the
  findings. A duplicate clean `gtd step agent` between review turns cannot
  approve on its own — it can only record one inert empty fixer turn. The
  review is force-approved without ever writing FEEDBACK.md when the
  kill-switch `agenticReview: false` is set, or when the review-fix threshold
  has already been reached in the current cycle.

  Scenario: gtd next emits the agentic-review prompt with the package task text
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: agentic-review"
    When I run gtd next
    Then it succeeds
    And stdout contains "Implement the helper."

  Scenario: An empty FEEDBACK.md approves and closes the package in the same turn
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: agentic-review"
    And an empty file ".gtd/FEEDBACK.md"
    When I run gtd step agent
    Then it succeeds
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      gtd: building
      gtd: agentic-review
      gtd(agent): agentic-approved
      gtd: close-package
      """
    And the file ".gtd/FEEDBACK.md" does not exist
    And the file ".gtd/01-foo/01-task.md" does not exist

  Scenario: Findings in FEEDBACK.md rest for the fixing prompt
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: agentic-review"
    And a file ".gtd/FEEDBACK.md" with:
      """
      Finding: helper does not handle the empty-string case.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): agentic-findings"
    When I run gtd next
    Then it succeeds
    And stdout contains "Finding: helper does not handle the empty-string case."

  Scenario: A duplicate clean step-agent after the findings turn cannot approve
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: agentic-review"
    And a file ".gtd/FEEDBACK.md" with:
      """
      Finding: helper does not handle the empty-string case.
      """
    And I run gtd step agent
    Then I record the commit count
    # The findings are on the record; a clean re-run has nothing to capture —
    # it is inert (no empty fixer turn commit) and never an implicit approval.
    When I run gtd step agent
    Then it succeeds
    And the commit count is unchanged
    And the git log does not contain "gtd: close-package"
    When I run gtd next
    Then it succeeds
    And stdout contains "Finding: helper does not handle the empty-string case."

  Scenario: agenticReview false force-approves without ever writing FEEDBACK.md
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      agenticReview: false
      testCommand: "true"
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd(agent): building" that adds "src/helper.ts" with:
      """
      export const helper = () => 42
      """
    # The green check captures the force-approved close inline.
    When I run gtd step check
    Then it succeeds
    And the git log contains "gtd(check): close-package"
    And the git log contains "gtd: close-package"
    And the git log does not contain "gtd(check): agentic-review"
    And the file ".gtd/01-foo/01-task.md" does not exist
    And the file ".gtd/FEEDBACK.md" does not exist

  Scenario: The review-fix threshold force-approves a green re-test without re-prompting review
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      reviewThreshold: 2
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd(agent): agentic-review" that adds ".gtd/FEEDBACK.md" with:
      """
      Finding: round one.
      """
    And a commit "gtd(agent): agentic-review" that adds ".gtd/FEEDBACK.md" with:
      """
      Finding: round two.
      """
    And a file "src/fix.ts" with:
      """
      export const fix = 1
      """
    And a commit "gtd(agent): fixing" with counters "t=0 r=2 h=0"
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd: close-package"
    And stdout does not contain "Spawn a **reviewing subagent**"
    And the file ".gtd/01-foo/01-task.md" does not exist

  Scenario: The findings round that crosses the review threshold routes to fixing instead of dead-resting
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      reviewThreshold: 2
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd(agent): agentic-review" that adds ".gtd/FEEDBACK.md" with:
      """
      Finding: round one.
      """
    And a commit "gtd(agent): fixing" that deletes ".gtd/FEEDBACK.md"
    And a commit "gtd: agentic-review"
    And a commit "gtd(agent): agentic-findings" that adds ".gtd/FEEDBACK.md" with:
      """
      Finding: round two.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Finding: round two."
    And stdout contains "Spawn a **fix subagent**"
    And stdout does not contain "Spawn a **reviewing subagent**"

  Scenario: An approval turn that crosses the review threshold still closes the package
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      reviewThreshold: 2
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd(agent): agentic-review" that adds ".gtd/FEEDBACK.md" with:
      """
      Finding: round one.
      """
    And a commit "gtd(agent): fixing" that deletes ".gtd/FEEDBACK.md"
    And a commit "gtd: agentic-review"
    And a commit "gtd(agent): agentic-approved" that adds ".gtd/FEEDBACK.md" with:
      """
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd: close-package"
    And the file ".gtd/01-foo/01-task.md" does not exist
    And the file ".gtd/FEEDBACK.md" does not exist
