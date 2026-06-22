# Aspirational — covers example.md Rule 4 (decomposition). Packages are
# ordinal-prefixed, emitted in dependency order, frozen after creation, each
# green on its own, with file-disjoint tasks (shared-file tasks merged).
# Allowed to fail.

Feature: Decomposition produces a frozen, ordered package set

  Scenario: Decompose emits ordinal-prefixed packages in dependency order
    Given a test project
    And a commit "docs: finalize plan" that adds "TODO.md" with:
      """
      ---
      status: complete
      ---

      ## Plan

      - build the parser, then the evaluator that depends on it
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "dependency order"
    And stdout contains "ordinal"

  Scenario: Decompose instructs that each package must leave the tree green on its own
    Given a test project
    And a commit "docs: finalize plan" that adds "TODO.md" with:
      """
      ---
      status: complete
      ---

      ## Plan

      - build a multi-part feature
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "green on its own"

  Scenario: Decompose instructs file-disjoint tasks, merging tasks that share files
    Given a test project
    And a commit "docs: finalize plan" that adds "TODO.md" with:
      """
      ---
      status: complete
      ---

      ## Plan

      - build a multi-part feature
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "file-disjoint"
    And stdout contains "merge"

  Scenario: Decompose records TODO.md verbatim before removing it
    Given a test project
    And a commit "docs: finalize plan" that adds "TODO.md" with:
      """
      ---
      status: complete
      ---

      ## Plan

      - build the multiply function
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "docs(plan): record TODO.md"

  Scenario: An existing package set is frozen — decomposition does not run again
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
    And stdout does not contain "## Task: Decompose"
