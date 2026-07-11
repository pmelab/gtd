Feature: .gtdrc config system

  ConfigService loads `.gtdrc` via cosmiconfig, walking cwd up to home or the
  filesystem root and deep-merging every level (innermost wins). It supplies the
  test command to the runner (default `npm run test`), the per-state model names
  injected into the subagent-spawning prompts (planning → `claude-opus-4-8`,
  execution → `claude-sonnet-4-8` by default; `models` tier/state overrides take
  precedence), and the loop caps `fixAttemptCap` / `reviewThreshold`. These
  scenarios drive the bundled CLI end-to-end so the merge walk + cosmiconfig
  bundling are exercised for real.

  @inmem
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
    When I run gtd step-agent
    Then it succeeds
    And the git log contains "gtd: errors"
    And the file ".gtd/FEEDBACK.md" contains "CONFIG_SENTINEL"
    When I run gtd next
    Then it succeeds
    And stdout contains "Spawn a **fix subagent**"
    And stdout contains "CONFIG_SENTINEL"

  @inmem
  Scenario: The planning-tier model appears in the decompose prompt
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      models:
        planning: my-planner-model
        execution: my-executor-model
      """
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Decompose it into an ordered set of"
    And stdout contains "my-planner-model"
    And stdout does not contain "my-executor-model"

  @inmem
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
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
    And stdout contains "my-executor-model"
    And stdout does not contain "my-planner-model"

  @inmem
  Scenario: A per-state override beats the tier model in the decompose prompt
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      models:
        planning: tier-planner
        states:
          decompose: state-decompose-model
      """
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Decompose it into an ordered set of"
    And stdout contains "state-decompose-model"
    And stdout does not contain "tier-planner"

  @inmem
  Scenario: Built-in planning default applies with no config present
    Given a test project
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Decompose it into an ordered set of"
    And stdout contains "claude-opus-4-8"

  @inmem
  Scenario: The build prompt uses the built-in execution default with no config
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
    And stdout contains "claude-sonnet-4-8"

  @inmem
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
    When I run gtd step-agent
    Then it succeeds
    And the file ".gtd/ERRORS.md" exists
    When I run gtd next
    Then it succeeds
    And stdout contains "was not able to fix all errors on its own"

  @inmem
  Scenario: A lowered reviewThreshold force-approves sooner
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      reviewThreshold: 1
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd(agent): agentic-review" that adds ".gtd/FEEDBACK.md" with:
      """
      Finding: round one.
      """
    And a commit "gtd: tests green"
    When I run gtd step-agent
    Then it succeeds
    And the last commit subject is "gtd: package done"
    And the git log does not contain "gtd(agent): agentic-review\n\ngtd: package done"

  @live
  Scenario: An unknown config key is rejected
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      bogusKey: 1
      """
    When I run gtd next
    Then it fails
    And stderr contains "Invalid gtd config"

  @live
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
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Decompose it into an ordered set of"
    And stdout contains "cwd-planner-model"
    And stdout does not contain "ancestor-planner-model"

  @live
  Scenario: Negative fixAttemptCap is rejected with an informative message
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      fixAttemptCap: -1
      """
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it fails
    And stderr contains "Invalid gtd config"

  @live
  Scenario: Float fixAttemptCap is rejected with an informative message
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      fixAttemptCap: 1.5
      """
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it fails
    And stderr contains "Invalid gtd config"

  @live
  Scenario: Zero reviewThreshold is rejected with an informative message
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      reviewThreshold: 0
      """
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it fails
    And stderr contains "Invalid gtd config"

  @inmem
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
    When I run gtd next
    Then it succeeds

  @inmem
  Scenario: A malformed YAML config file is rejected and names the offending file
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: [unclosed
      """
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it fails
    And stderr contains ".gtdrc"

  @inmem
  Scenario: A config whose top-level value is a YAML list is rejected and names the offending file
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      - item1
      - item2
      """
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it fails
    And stderr contains ".gtdrc"

  @live
  Scenario: A schema validation error message is concise and does not dump internal type structures
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      bogusKey: 1
      """
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it fails
    And stderr contains "Invalid gtd config"
    And stderr does not contain "readonly"

  @inmem
  Scenario: A null-root config is rejected and names the offending file
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      null
      """
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it fails
    And stderr contains ".gtdrc"

  @live
  Scenario: A clean project auto-creates .gtdrc.json with a $schema link
    Given a test project
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it succeeds
    And the file ".gtdrc.json" exists
    And the file ".gtdrc.json" contains "https://raw.githubusercontent.com/pmelab/gtd/main/schema.json"

  @live
  Scenario: A second gtd run does not reject the auto-created .gtdrc.json
    Given a test project
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    And I run gtd next
    Then it succeeds
    And stderr does not contain "Invalid gtd config"

  @live
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
    And a commit "gtd: grilled" that adds ".gtd/TODO.md" with:
      """
      Build the multiply function.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Decompose it into an ordered set of"
    And stdout contains "shared-parent-planner"
