@inmem
Feature: Fixing — consume FEEDBACK.md written by a red build turn

  A committed, non-empty FEEDBACK.md rests at the fixing prompt for the agent
  — `gtd next` inlines the FEEDBACK.md text verbatim. The fixer's turn commit
  is `gtd(agent): fixing`, and the capture CONSUMES the finding: FEEDBACK.md's
  deletion lands in the turn's own diff, so the next check starts from a
  clean slate. The turn then rests at testing for the check actor; a green
  `gtd step check` captures the outcome label (`gtd(check): agentic-review`
  with packages and review on). Disputing by deleting or emptying FEEDBACK.md
  is captured the same way. A fixer that produces no change at all is inert —
  no commit — and `gtd next` re-emits the same fixing prompt.

  Scenario: gtd next emits the fixing prompt containing the FEEDBACK.md text
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: test-failed" that adds ".gtd/FEEDBACK.md" with:
      """
      AssertionError: expected helper('a') to equal 'a'
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "AssertionError: expected helper('a') to equal 'a'"

  Scenario: A fixer turn with code edits removes FEEDBACK.md and re-tests green
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: test-failed" that adds ".gtd/FEEDBACK.md" with:
      """
      AssertionError: expected helper('a') to equal 'a'
      """
    And a file "src/helper.ts" with:
      """
      export const helper = (x: string) => x
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): fixing"
    And the file ".gtd/FEEDBACK.md" does not exist
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): agentic-review"

  Scenario: A disputing fixer deletes FEEDBACK.md and the chain re-tests green
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: test-failed" that adds ".gtd/FEEDBACK.md" with:
      """
      AssertionError: expected helper('a') to equal 'a'
      """
    And a deleted committed file ".gtd/FEEDBACK.md"
    When I run gtd step agent
    Then it succeeds
    And the file ".gtd/FEEDBACK.md" does not exist
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): agentic-review"

  Scenario: A disputing fixer empties FEEDBACK.md and the chain re-tests green
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: test-failed" that adds ".gtd/FEEDBACK.md" with:
      """
      AssertionError: expected helper('a') to equal 'a'
      """
    And an empty file ".gtd/FEEDBACK.md"
    When I run gtd step agent
    Then it succeeds
    And the file ".gtd/FEEDBACK.md" does not exist
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): agentic-review"

  Scenario: A do-nothing fixer invocation is inert — no commit, no re-test, next re-emits the fixing prompt
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: test-failed" that adds ".gtd/FEEDBACK.md" with:
      """
      AssertionError: expected helper('a') to equal 'a'
      """
    Then I record the commit count
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd: test-failed"
    And the commit count is unchanged
    When I run gtd next
    Then it succeeds
    And stdout contains "AssertionError: expected helper('a') to equal 'a'"
    When I run gtd step agent
    Then it succeeds
    And the commit count is unchanged

  Scenario: Disputing by deleting FEEDBACK.md is captured as the fixer turn and re-tests
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: test-failed" that adds ".gtd/FEEDBACK.md" with:
      """
      AssertionError: expected helper('a') to equal 'a'
      """
    And a deleted committed file ".gtd/FEEDBACK.md"
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): fixing"
    And the file ".gtd/FEEDBACK.md" does not exist
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): agentic-review"
