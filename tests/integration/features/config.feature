Feature: .gtdrc config system

  ConfigService loads `.gtdrc` via cosmiconfig, walking cwd up to home or the
  filesystem root and deep-merging every level (innermost wins). It supplies the
  test command to the runner (default `npm run test`) and the per-state model
  names injected into the five subagent-spawning prompts (planning →
  `claude-opus-4-8`, execution → `claude-sonnet-4-8` by default; `models`
  tier/state overrides take precedence). These scenarios drive the bundled CLI
  end-to-end so the merge walk + cosmiconfig bundling are exercised for real.

  Scenario: A custom testCommand reaches the runner and beats the default
    # The execute test gate runs the resolved testCommand (NOT package.json
    # directly), so a custom red command's sentinel surfaces in the fix-tests
    # prompt. No package.json `test` script is present — proving config, not the
    # default `npm run test`, drove the gate. The pending `.gtd/01-foo/` package
    # reaches the execute gate (human-review is no longer test-gated).
    Given a test project
    And a commit "chore: add gate.sh" that adds "gate.sh" with:
      """
      echo CONFIG_SENTINEL
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      First task
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Test gate failed"
    And stdout contains "CONFIG_SENTINEL"

  Scenario: Per-state models appear in the planning and execution prompt sections
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      models:
        planning: my-planner-model
        execution: my-executor-model
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      ---
      status: complete
      ---

      - build the multiply function
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "my-planner-model"
    And stdout does not contain "my-executor-model"

  Scenario: The execution-tier model appears in the execute prompt
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      models:
        planning: my-planner-model
        execution: my-executor-model
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
    And stdout contains "my-executor-model"
    And stdout does not contain "my-planner-model"

  Scenario: A per-state override beats the tier model in the decompose prompt
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      models:
        planning: tier-planner
        states:
          decompose: state-decompose-model
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      ---
      status: complete
      ---

      - build the multiply function
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "state-decompose-model"
    And stdout does not contain "tier-planner"

  Scenario: Built-in defaults apply with no config present
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      ---
      status: complete
      ---

      - build the multiply function
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "claude-opus-4-8"

  Scenario: The execute prompt uses the built-in execution default with no config
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
    And stdout contains "claude-sonnet-4-8"

  Scenario: The fix-tests prompt carries no injected model directive
    # A red gate below the cap emits fix-tests, which spawns no subagent and so
    # carries no model. The config sets a testCommand only (no models) so the
    # absence of the raw {{MODEL}} token proves no model injection happened.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "chore: add gate.sh" that adds "gate.sh" with:
      """
      echo CONFIG_SENTINEL
      exit 1
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      First task
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Test gate failed"
    And stdout contains "CONFIG_SENTINEL"
    And stdout does not contain "{{MODEL}}"

  Scenario: cwd config wins over an ancestor for an overlapping key while non-overlapping keys cascade
    # The shared parent sets testCommand AND a planning model; the repo's cwd
    # .gtdrc overrides only the planning model. The decompose prompt must show
    # the cwd planning model (innermost wins) while the test gate would use the
    # ancestor testCommand for the overlapping side — proving merge-all-levels.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      models:
        planning: cwd-planner-model
      """
    And a shared parent directory with a gtd config:
      """
      testCommand: bash gate.sh
      models:
        planning: ancestor-planner-model
        execution: ancestor-executor-model
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      ---
      status: complete
      ---

      - build the multiply function
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "cwd-planner-model"
    And stdout does not contain "ancestor-planner-model"

  Scenario: A config in a shared parent directory cascades down to a repo beneath it
    # Only the shared (non-git-root) parent carries a .gtdrc; the repo has none.
    # The ancestor's planning model must still reach the decompose prompt,
    # proving the cwd→root walk picks up configs in shared parents.
    Given a test project
    And a shared parent directory with a gtd config:
      """
      models:
        planning: shared-parent-planner
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      ---
      status: complete
      ---

      - build the multiply function
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "shared-parent-planner"
