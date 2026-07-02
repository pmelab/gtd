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

  # STOP/prompt states with no edge action must be perfectly replayable. (Auto
  # and approval states are intentionally NOT idempotent: re-running at
  # `gtd: new task` regenerates the seed, and re-running at a committed
  # REVIEW.md approves it — see STATES.md § Done.)
  Scenario: Re-running at the Escalate gate is idempotent
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: errors" that adds "ERRORS.md" with:
      """
      persistent failure output
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Escalate — the test gate is stuck"
    And I record the commit count
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Escalate — the test gate is stuck"
    And the commit count is unchanged
    And the file "ERRORS.md" exists

  Scenario: Re-running at Clean (review authoring pending) is idempotent
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: branch work" that adds "src/feat.ts" with:
      """
      export const feat = 1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
    And I record the commit count
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
    And the commit count is unchanged

  # Interruption recovery: a run killed between the `gtd: building` commit and
  # the review verdict leaves a clean tree under HEAD `gtd: building` — the
  # next run re-detects Agentic Review with no data loss, indefinitely.
  Scenario: Re-running at a pending agentic review is idempotent
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] helper
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: building" that adds "src/helper.ts" with:
      """
      export const helper = () => 1
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Agentic review of the built package"
    And I record the commit count
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Agentic review of the built package"
    And the commit count is unchanged
