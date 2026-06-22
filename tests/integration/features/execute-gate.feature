Feature: Execute one-package-per-cycle test gate

  The `execute` leaf is reached when `.gtd/` holds a numbered package with task
  files and the tree is otherwise clean. The edge runs the project test suite
  first: a green run emits the one-package execute prompt (execute EXACTLY ONE
  lowest-numbered package); a red run below the cap emits the fix-tests prompt
  with the captured failure output; a red run at the consecutive-fix(gtd) cap
  escalates to the human (the edge cap overrides the machine's
  hasPackages-before-capReached ordering). The fixture commits package.json (a
  controllable `test` script) and the `.gtd/01-foo/` package so the tree is
  clean and the leaf resolves to execute.

  Scenario: Green test gate emits the one-package execute prompt
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      First task
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/COMMIT_MSG.md" with:
      """
      feat: first
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Execute one work package"
    And stdout contains "01-foo"
    And stdout contains "First task"
    And stdout does not contain "lowest-numbered"
    And stdout does not contain "## Test gate failed"

  Scenario: Red test gate below the cap emits the fix-tests prompt with captured output
    Given a test project
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "echo EXEC_SENTINEL; exit 1" } }
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      First task
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/COMMIT_MSG.md" with:
      """
      feat: first
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Test gate failed"
    And stdout contains "fix(gtd): <desc>"
    And stdout contains "EXEC_SENTINEL"
    And stdout does not contain "## Task: Execute one work package"

  Scenario: A red test gate at the consecutive-fix(gtd) cap escalates to the human
    # The .gtd/01-foo/ package stays present so the leaf is `execute`
    # (hasPackages), yet at the cap the edge escalates before running the gate —
    # proving the edge cap overrides the hasPackages-before-capReached ordering.
    # The 5 fix(gtd) commits must be in the counted range, so the default branch
    # differs from the feature branch they live on (mirrors verify-loop.feature).
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "echo EXEC_SENTINEL; exit 1" } }
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      First task
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/COMMIT_MSG.md" with:
      """
      feat: first
      """
    And a fix(gtd) commit "fix(gtd): attempt 1"
    And a fix(gtd) commit "fix(gtd): attempt 2"
    And a fix(gtd) commit "fix(gtd): attempt 3"
    And a fix(gtd) commit "fix(gtd): attempt 4"
    And a fix(gtd) commit "fix(gtd): attempt 5"
    When I run gtd
    Then it succeeds
    And stdout contains "Escalate to the human"
    And stdout does not contain "## Test gate failed"
    And stdout does not contain "## Task: Execute one work package"
