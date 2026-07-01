Feature: .gtdrc config system

  ConfigService loads `.gtdrc` via cosmiconfig, walking cwd up to home or the
  filesystem root and deep-merging every level (innermost wins). It supplies the
  test command to the runner (default `npm run test`), the per-state model names
  injected into the subagent-spawning prompts (planning → `claude-opus-4-8`,
  execution → `claude-sonnet-4-8` by default; `models` tier/state overrides take
  precedence), and the loop caps `fixAttemptCap` / `reviewThreshold`. These
  scenarios drive the bundled CLI end-to-end so the merge walk + cosmiconfig
  bundling are exercised for real.

  Scenario: A custom testCommand reaches the runner and beats the default
    # No package.json `test` script exists, so the sentinel surfacing in the fix
    # prompt proves the configured testCommand — not the default `npm run test` —
    # drove the gate.
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
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file "src/helper.ts" with:
      """
      export const helper = (x: string) => x
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Fix the package against `FEEDBACK.md`"
    And stdout contains "CONFIG_SENTINEL"

  Scenario: The planning-tier model appears in the decompose prompt
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      models:
        planning: my-planner-model
        execution: my-executor-model
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose the plan into work packages"
    And stdout contains "my-planner-model"
    And stdout does not contain "my-executor-model"

  Scenario: The execution-tier model appears in the build prompt
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      models:
        planning: my-planner-model
        execution: my-executor-model
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Build one work package"
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
      Build the multiply function.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose the plan into work packages"
    And stdout contains "state-decompose-model"
    And stdout does not contain "tier-planner"

  Scenario: Built-in planning default applies with no config present
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose the plan into work packages"
    And stdout contains "claude-opus-4-8"

  Scenario: The build prompt uses the built-in execution default with no config
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Build one work package"
    And stdout contains "claude-sonnet-4-8"

  Scenario: A lowered fixAttemptCap escalates sooner
    # With the cap at 1, a single prior `gtd: errors` exhausts the budget, so the
    # next red test writes ERRORS.md and escalates instead of FEEDBACK.md.
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: add gate.sh" that adds "gate.sh" with:
      """
      echo CONFIG_SENTINEL
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      fixAttemptCap: 1
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: errors"
    And a file "src/helper.ts" with:
      """
      export const helper = (x: string) => x
      """
    When I run gtd
    Then it succeeds
    And the file "ERRORS.md" exists
    And stdout contains "## Task: Escalate"

  Scenario: A lowered reviewThreshold force-approves sooner
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a gtd config file at ".gtdrc" with:
      """
      reviewThreshold: 1
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: feedback"
    And a commit "gtd: building"
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: package done"
    And stdout does not contain "## Task: Agentic review of the built package"

  Scenario: An unknown config key is rejected
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      bogusKey: 1
      """
    When I run gtd
    Then it fails
    And stderr contains "Invalid gtd config"

  Scenario: cwd config wins over an ancestor for an overlapping key while non-overlapping keys cascade
    # The shared parent sets testCommand AND a planning model; the repo's cwd
    # .gtdrc overrides only the planning model. The decompose prompt must show the
    # cwd planning model (innermost wins) while the ancestor testCommand still
    # cascades for the non-overlapping side — proving merge-all-levels.
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
      Build the multiply function.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose the plan into work packages"
    And stdout contains "cwd-planner-model"
    And stdout does not contain "ancestor-planner-model"

  Scenario: Negative fixAttemptCap is rejected with an informative message
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      fixAttemptCap: -1
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd
    Then it fails
    And stderr contains "Invalid gtd config"

  Scenario: Float fixAttemptCap is rejected with an informative message
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      fixAttemptCap: 1.5
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd
    Then it fails
    And stderr contains "Invalid gtd config"

  Scenario: Zero reviewThreshold is rejected with an informative message
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      reviewThreshold: 0
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd
    Then it fails
    And stderr contains "Invalid gtd config"

  Scenario: fixAttemptCap of zero is accepted as a valid config
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      fixAttemptCap: 0
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    When I run gtd
    Then it succeeds

  Scenario: A malformed YAML config file is rejected and names the offending file
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: [unclosed
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd
    Then it fails
    And stderr contains ".gtdrc"

  Scenario: A config whose top-level value is a YAML list is rejected and names the offending file
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      - item1
      - item2
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd
    Then it fails
    And stderr contains ".gtdrc"

  Scenario: A schema validation error message is concise and does not dump internal type structures
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      bogusKey: 1
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd
    Then it fails
    And stderr contains "Invalid gtd config"
    And stderr does not contain "readonly"

  Scenario: A null-root config is rejected and names the offending file
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      null
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd
    Then it fails
    And stderr contains ".gtdrc"

  Scenario: A config in a shared parent directory cascades down to a repo beneath it
    # Only the shared (non-git-root) parent carries a .gtdrc; the repo has none.
    # The ancestor's planning model must still reach the decompose prompt, proving
    # the cwd→root walk picks up configs in shared parents.
    Given a test project
    And a shared parent directory with a gtd config:
      """
      models:
        planning: shared-parent-planner
      """
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose the plan into work packages"
    And stdout contains "shared-parent-planner"
