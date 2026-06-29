Feature: Per-package spec-review gate

  # After a package is executed (COMMIT_MSG.md consumed, spec .md files remain),
  # gtd runs a spec-review gate for each package. A green test + committed-but-
  # unreviewed package triggers the spec-review prompt. An empty FEEDBACK.md
  # approves the package (removes its .gtd dir), content-bearing FEEDBACK.md
  # triggers a fix prompt, and a Gtd-Spec-Review: commit re-enters the loop.
  # A per-package cycle cap and agenticReview:false both short-circuit the gate.

  Scenario: Green tested committed-unreviewed package emits spec-review prompt with specs and diff
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a committed-unreviewed package ".gtd/01-foo" with spec:
      """
      - [ ] The helper must return the input unchanged
      """
    And a commit "feat(01-foo): implement helper" that adds "src/helper.ts" with:
      """
      export function helper(x: string) { return x }
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Spec review of the committed package"
    And stdout contains "The helper must return the input unchanged"
    And stdout contains "src/helper.ts"
    And stdout contains "claude-opus-4"

  Scenario: Empty FEEDBACK.md approves: commits chore(gtd): approve, removes .gtd/pkg, advances
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a committed-unreviewed package ".gtd/01-foo" with spec:
      """
      - [ ] The helper must return the input unchanged
      """
    And a commit "feat(01-foo): implement helper" that adds "src/helper.ts" with:
      """
      export function helper(x: string) { return x }
      """
    And an untracked file "FEEDBACK.md" with:
      """

      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "chore(gtd): approve spec review for 01-foo"
    And the file ".gtd/01-foo" does not exist
    And the file "FEEDBACK.md" does not exist

  Scenario: Content-bearing FEEDBACK.md emits spec-fix prompt
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a committed-unreviewed package ".gtd/01-foo" with spec:
      """
      - [ ] The helper must return the input unchanged
      """
    And a commit "feat(01-foo): implement helper" that adds "src/helper.ts" with:
      """
      export function helper(x: string) { return x }
      """
    And an untracked file "FEEDBACK.md" with:
      """
      - The helper does not handle null input
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Fix the package against spec-review feedback"

  Scenario: Committed Gtd-Spec-Review: fix commit then green test re-emits spec-review prompt
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a committed-unreviewed package ".gtd/01-foo" with spec:
      """
      - [ ] The helper must return the input unchanged
      """
    And a commit "feat(01-foo): implement helper" that adds "src/helper.ts" with:
      """
      export function helper(x: string) { return x }
      """
    And a prior spec review fix commit "1"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Spec review of the committed package"

  Scenario: Per-package cap reached: gate falls through without emitting spec-review prompt
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a committed-unreviewed package ".gtd/01-foo" with spec:
      """
      - [ ] The helper must return the input unchanged
      """
    And a commit "feat(01-foo): implement helper" that adds "src/helper.ts" with:
      """
      export function helper(x: string) { return x }
      """
    And a prior spec review fix commit "1"
    And a prior spec review fix commit "2"
    And a prior spec review fix commit "3"
    When I run gtd
    Then it succeeds
    And stdout does not contain "## Task: Spec review of the committed package"

  Scenario: agenticReview false skips spec-review gate entirely and advances
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a committed-unreviewed package ".gtd/01-foo" with spec:
      """
      - [ ] The helper must return the input unchanged
      """
    And a commit "feat(01-foo): implement helper" that adds "src/helper.ts" with:
      """
      export function helper(x: string) { return x }
      """
    And a gtd config file at ".gtdrc" with:
      """
      agenticReview: false
      """
    When I run gtd
    Then it succeeds
    And stdout does not contain "## Task: Spec review of the committed package"

  Scenario: Execute commit leaves spec .md files but removes COMMIT_MSG.md (awaiting-review signal)
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      - [ ] The helper must return the input unchanged
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/COMMIT_MSG.md" with:
      """
      feat(01-foo): implement helper
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Execute one work package"
