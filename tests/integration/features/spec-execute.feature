# Aspirational — covers example.md Rule 5 (execution). Packages run
# sequentially by ordinal (lowest first), one subagent per file-disjoint task,
# never in parallel across packages; on a green test loop the package is
# removed and the next one runs. Allowed to fail.

Feature: Packages execute sequentially, lowest ordinal first

  Scenario: Execute picks exactly the lowest-numbered remaining package
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      First task
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/02-bar/01-task.md" with:
      """
      Second task
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Execute one work package"
    And stdout contains "01-foo"
    And stdout contains "First task"
    And stdout does not contain "Second task"

  Scenario: Execute launches one subagent per task in the package
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-add.md" with:
      """
      Implement add in src/add.ts
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/02-sub.md" with:
      """
      Implement sub in src/sub.ts
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Execute one work package"
    And stdout contains "one subagent per task"
    And stdout contains "01-add.md"
    And stdout contains "02-sub.md"

  Scenario: A green package removes the package and continues to the next cycle
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      First task
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Execute one work package"
    And stdout contains "remove the now-empty `.gtd/` directory"
    And stdout contains "Re-run gtd immediately"
