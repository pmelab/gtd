Feature: Automatic markdown formatting on commit

  Scenario: Pre-commit hook wraps long lines in TODO.md
    Given a test project
    And prettier is available in the test project
    And the pre-commit hook from the project is installed
    And a file "TODO.md" with:
      """
      This is a very long line that exceeds eighty characters and should be wrapped by prettier when committed.
      """
    And "TODO.md" is staged
    When I commit with message "docs: test formatting"
    Then "TODO.md" has no lines longer than 80 characters

  Scenario: Pre-commit hook wraps long lines in REVIEW.md
    Given a test project
    And prettier is available in the test project
    And the pre-commit hook from the project is installed
    And a file "REVIEW.md" with:
      """
      This is a very long line that exceeds eighty characters and should be wrapped by prettier when committed.
      """
    And "REVIEW.md" is staged
    When I commit with message "review: test formatting"
    Then "REVIEW.md" has no lines longer than 80 characters

  Scenario: format subcommand wraps long lines in place
    Given a test project
    And prettier is available in the test project
    And a file "TODO.md" with:
      """
      This is a very long line that exceeds eighty characters and should be wrapped by the format subcommand when run directly.
      """
    When I run gtd with args "format TODO.md"
    Then the exit code is 0
    And stdout is empty
    And "TODO.md" has no lines longer than 80 characters

  Scenario: format subcommand skips missing files gracefully
    Given a test project
    And prettier is available in the test project
    When I run gtd with args "format does-not-exist.md"
    Then the exit code is 0
    And stderr contains "gtd: skipped formatting does-not-exist.md:"

  Scenario: Pre-commit hook does not modify other markdown files
    Given a test project
    And prettier is available in the test project
    And the pre-commit hook from the project is installed
    And a file "notes.md" with:
      """
      This is a very long line that exceeds eighty characters and should NOT be wrapped because it is not TODO or REVIEW.
      """
    And "notes.md" is staged
    When I commit with message "docs: test other file"
    Then "notes.md" still has a line longer than 80 characters
