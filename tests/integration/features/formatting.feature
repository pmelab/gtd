@live
Feature: Automatic markdown formatting on commit

  Scenario: Pre-commit hook wraps long lines in TODO.md
    Given a test project
    And prettier is available in the test project
    And an executable pre-commit hook with:
      """
      #!/bin/sh
      FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^(TODO|REVIEW)\.md$')

      if [ -n "$FILES" ]; then
        npx prettier --write $FILES
        git add $FILES
      fi
      """
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
    And an executable pre-commit hook with:
      """
      #!/bin/sh
      FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^(TODO|REVIEW)\.md$')

      if [ -n "$FILES" ]; then
        npx prettier --write $FILES
        git add $FILES
      fi
      """
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

  Scenario: format subcommand fails with exit 1 when path argument is missing
    Given a test project
    And prettier is available in the test project
    When I run gtd with args "format"
    Then the exit code is 1
    And stderr contains "gtd format: missing file path argument"

  Scenario: format subcommand fails with exit 1 for nonexistent file
    Given a test project
    And prettier is available in the test project
    When I run gtd with args "format does-not-exist.md"
    Then the exit code is 1
    And stderr contains "gtd: skipped formatting does-not-exist.md:"

  Scenario: format subcommand rejects non-markdown file with exit 1
    Given a test project
    And prettier is available in the test project
    And a file "notes.txt" with:
      """
      This is a plain text file that should not be formatted.
      """
    When I run gtd with args "format notes.txt"
    Then the exit code is 1
    And stderr contains "notes.txt"

  Scenario: format subcommand accepts .markdown extension
    Given a test project
    And prettier is available in the test project
    And a file "notes.markdown" with:
      """
      This is a very long line that exceeds eighty characters and should be wrapped by the format subcommand when run directly.
      """
    When I run gtd with args "format notes.markdown"
    Then the exit code is 0
    And "notes.markdown" has no lines longer than 80 characters

  Scenario: format subcommand rejects extra trailing arguments
    Given a test project
    And prettier is available in the test project
    And a file "TODO.md" with:
      """
      Short line.
      """
    And a file "extra.md" with:
      """
      Another file.
      """
    When I run gtd with args "format TODO.md extra.md"
    Then the exit code is 1
    And stderr contains "gtd format: too many arguments"

  Scenario: Pre-commit hook does not modify other markdown files
    Given a test project
    And prettier is available in the test project
    And an executable pre-commit hook with:
      """
      #!/bin/sh
      FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^(TODO|REVIEW)\.md$')

      if [ -n "$FILES" ]; then
        npx prettier --write $FILES
        git add $FILES
      fi
      """
    And a file "notes.md" with:
      """
      This is a very long line that exceeds eighty characters and should NOT be wrapped because it is not TODO or REVIEW.
      """
    And "notes.md" is staged
    When I commit with message "docs: test other file"
    Then "notes.md" still has a line longer than 80 characters
