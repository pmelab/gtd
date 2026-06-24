Feature: Edge-driven loop actions (Part A) and intent-disambiguated commits (Part B)

  Part A retires the cleanup / close-review / code-changes PROMPTS: each is now an
  edge action that a single gtd run performs before driving the loop to the next
  leaf. Part B has agent-producing states leave their work UNCOMMITTED plus a
  `.gtd-commit-intent` marker (repo root) naming the producing state; the NEXT gtd
  run's edge commits with the disambiguated subject (and, for execute, removes the
  consumed `.gtd/NN-…` package), then advances.

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

  # ── Part B: execute ───────────────────────────────────────────────────────
  Scenario: Execute output left uncommitted with an `execute` marker commits with the package COMMIT_MSG and removes the package
    # The agent ran the package, wrote source, but left it uncommitted plus an
    # `execute` marker. The next run's edge commits the source using COMMIT_MSG.md
    # as the subject and removes the consumed `.gtd/01-foo/` package in the same
    # commit.
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
    And a commit-intent marker "execute"
    When I run gtd
    Then it succeeds
    And the git log contains "feat(gtd): implement foo"
    And the file ".gtd/01-foo" does not exist
    And the file ".gtd-commit-intent" does not exist

  # ── Part B: decompose ─────────────────────────────────────────────────────
  Scenario: Decompose output left uncommitted with a `decompose` marker commits with the package-count subject
    # The agent decomposed TODO.md into two packages but left them uncommitted plus
    # a `decompose` marker. The edge commits with the derived count subject.
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      ---
      status: complete
      ---

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
    And a commit-intent marker "decompose"
    When I run gtd
    Then it succeeds
    And the git log contains "plan(gtd): decompose TODO.md into 2 work packages"
    And the file ".gtd-commit-intent" does not exist

  # ── Part B: planning state (new-todo) ─────────────────────────────────────
  Scenario: New-todo output left uncommitted with a `new-todo` marker commits with the fixed record subject
    Given a test project
    And a file "TODO.md" with:
      """
      ## Open Questions

      ### What operations?

      **Recommendation:** add, subtract.

      <!-- user answers here -->

      ## Plan

      - build a math library
      """
    And a commit-intent marker "new-todo"
    When I run gtd
    Then it succeeds
    And the git log contains "docs(plan): record TODO.md"
    And the file ".gtd-commit-intent" does not exist

  # ── Part B: fix-tests ─────────────────────────────────────────────────────
  Scenario: Fix-tests output left uncommitted with a `fix-tests` marker commits with the Gtd-Test-Fix trailer
    # The fix-tests agent applied a fix but left it uncommitted plus a `fix-tests`
    # marker. The edge commits with the fix subject AND the load-bearing
    # `Gtd-Test-Fix:` trailer (the verify/escalate gate counts it).
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
    And a commit-intent marker "fix-tests"
    When I run gtd
    Then it succeeds
    And the last commit subject is "fix(gtd): apply test fix"
    And the last commit body contains "Gtd-Test-Fix:"
    And the file ".gtd-commit-intent" does not exist
