Feature: Replay — any committed point resumes deterministically

  State is derived from the repository, so re-running gtd at the same committed
  point yields the same decision with no extra side effects. Building carries no
  edge action, so two consecutive runs reach the identical prompt and leave the
  history untouched.

  Scenario: Re-running at a committed package point is idempotent
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: planning"
    And stdout contains "## Task: Build one work package"
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: planning"
    And stdout contains "## Task: Build one work package"
