@inmem
Feature: Fixing — consume FEEDBACK.md with a provenance-tagged commit

  A non-empty FEEDBACK.md routes to Fixing. The commit prefix records where the
  feedback came from: a committed FEEDBACK.md (written by Testing as
  `gtd: errors`) is consumed as `gtd: fixing`; an uncommitted FEEDBACK.md
  (written by Agentic Review) is consumed as `gtd: feedback`, the review-loop
  iteration marker. Either way the fixer prompt inlines the feedback verbatim.

  Scenario: A committed FEEDBACK.md is consumed as gtd: fixing
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: errors" that adds "FEEDBACK.md" with:
      """
      AssertionError: expected helper('a') to equal 'a'
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: fixing"
    And the file "FEEDBACK.md" does not exist
    And stdout contains "Spawn a **fix subagent**"
    And stdout contains "AssertionError: expected helper('a') to equal 'a'"

  Scenario: An uncommitted FEEDBACK.md is consumed as gtd: feedback
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file "FEEDBACK.md" with:
      """
      Finding: helper must trim whitespace before returning.
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: feedback"
    And the file "FEEDBACK.md" does not exist
    And stdout contains "Spawn a **fix subagent**"
    And stdout contains "Finding: helper must trim whitespace before returning."

  # Fixing must DELETE FEEDBACK.md (not just commit around it): the removal lands
  # in the `gtd: fixing` commit, so once the fixer applies its change the tree
  # re-detects Testing, not Fixing. Without the removal FEEDBACK persists at
  # precedence 2 and Fixing re-fires forever, never returning to the test gate.
  Scenario: fixAttemptCap=0 with human-resume (pending ERRORS.md deletion) escalates immediately
    # With cap=0, even a fresh-budget resume must escalate — 0 >= 0 is true.
    # The bug was: `resume ? false : count >= cap` hardcoded false on resume,
    # granting one unintended FEEDBACK attempt even when cap=0.
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo STILL_BROKEN
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      fixAttemptCap: 0
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: errors" that adds "ERRORS.md" with:
      """
      Earlier escalation output.
      """
    And a deleted committed file "ERRORS.md"
    When I run gtd
    Then it succeeds
    And the file "ERRORS.md" exists
    And stdout contains "was not able to fix all errors on its own"
    And stdout does not contain "Spawn a **fix subagent**"

  Scenario: Fixing removes FEEDBACK.md so the fixed tree returns to Testing
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
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: errors" that adds "FEEDBACK.md" with:
      """
      AssertionError: expected helper('a') to equal 'a'
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: fixing"
    And the file "FEEDBACK.md" does not exist
    # The fixer applies its change (left uncommitted) and re-runs gtd. With
    # FEEDBACK.md gone the tree resolves to Testing; the green gate then advances
    # to Agentic Review instead of looping back into Fixing.
    Given a file "src/helper.ts" with:
      """
      export const helper = (x: string) => x
      """
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: building"
    And the last commit subject is "gtd: building"
    And stdout contains "Spawn a **reviewing subagent**"
