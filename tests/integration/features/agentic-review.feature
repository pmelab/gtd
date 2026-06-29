Feature: Agentic Review — verdict-by-file, with force-approve guards

  A clean `.gtd/` under a `gtd: building` HEAD reviews the package and records the
  verdict in FEEDBACK.md. The verdict is a file, not a marker commit, so a
  pending review (no FEEDBACK.md yet) re-reviews rather than being mistaken for
  done. An empty FEEDBACK.md approves (Close package); a content-bearing one
  routes to Fixing. The review is force-approved when the kill-switch is off or
  the review-fix threshold is reached.

  Scenario: A built package with no FEEDBACK.md yet re-enters review (never skipped)
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: building"
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: building"
    And stdout contains "## Task: Agentic review of the built package"
    And stdout contains "Implement the helper."

  Scenario: An empty FEEDBACK.md approves and closes the package
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And an empty file "FEEDBACK.md"
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: package done"
    And the file ".gtd/01-foo/01-task.md" does not exist
    And the file "FEEDBACK.md" does not exist

  Scenario: A content-bearing FEEDBACK.md routes to a fix cycle
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file "FEEDBACK.md" with:
      """
      Finding: helper does not handle the empty-string case.
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: feedback"
    And stdout contains "## Task: Fix the package against `FEEDBACK.md`"

  Scenario: The review-fix threshold force-approves without reviewing
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: feedback"
    And a commit "gtd: feedback"
    And a commit "gtd: feedback"
    And a commit "gtd: building"
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: package done"
    And the file ".gtd/01-foo/01-task.md" does not exist
    And stdout does not contain "## Task: Agentic review of the built package"

  Scenario: agenticReview false force-approves without reviewing
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      agenticReview: false
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: package done"
    And the file ".gtd/01-foo/01-task.md" does not exist
    And stdout does not contain "## Task: Agentic review of the built package"
