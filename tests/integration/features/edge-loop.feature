Feature: Edge-driven loop actions

  # ── Part A: cleanup ───────────────────────────────────────────────────────
  Scenario: A stray empty .gtd directory is removed and the loop advances
    Given a test project
    And a directory ".gtd"
    When I run gtd
    Then it succeeds
    And the file ".gtd" does not exist
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"
    And stdout does not contain "## Task: Clean up after build completion"

  # ── Part A: code-changes ──────────────────────────────────────────────────
  Scenario: A dirty non-TODO file is committed and the loop advances
    Given a test project
    And a file "notes.txt" with:
      """
      stray scratch content
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "chore(gtd): commit pending changes"
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"
    And stdout does not contain "## Task: Commit the uncommitted changes"

  # ── Execute: dirty source after package work is committed via inferred intent ─
  Scenario: Dirty source left after execute work uses COMMIT_MSG subject
    # The agent ran the package and wrote source, but left it uncommitted.
    # Intent inference detects dirty source + package with COMMIT_MSG.md → uses the
    # COMMIT_MSG subject and removes the package dir in the same commit.
    Given a test project
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement foo
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/COMMIT_MSG.md" with:
      """
      feat(gtd): implement foo
      """
    And a file "src/foo.ts" with:
      """
      export const foo = () => 1
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "feat(gtd): implement foo"
    And the file ".gtd/01-foo" does not exist

  # ── Decompose: dirty .gtd packages are committed via code-changes ──────────
  Scenario: Dirty decompose packages are committed with the generic subject
    # The agent decomposed TODO.md into two packages but left them uncommitted.
    # The code-changes edge commits with the generic subject.
    Given a test project
    And a commit "plan(gtd): ready complete" that adds "TODO.md" with:
      """
      ## Plan

      - build a math library
      """
    And a directory ".gtd/01-foo"
    And a file ".gtd/01-foo/01-task.md" with:
      """
      First task
      """
    And a directory ".gtd/02-bar"
    And a file ".gtd/02-bar/01-task.md" with:
      """
      Second task
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "chore(gtd): commit pending changes"

  # ── Fix-tests: dirty fix output is committed via code-changes ─────────────
  Scenario: Dirty fix-tests output is committed with the generic subject
    # The fix-tests agent applied a fix but left it uncommitted.
    # The code-changes edge commits it with the generic subject.
    Given a test project
    And a commit "feat: math" that adds "src/math.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And "src/math.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "chore(gtd): commit pending changes"
