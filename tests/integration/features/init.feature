@live
Feature: gtd init — seed a minimal .gtdrc.json (default vars + formatting)

  `gtd init` (see src/program.ts) writes a MINIMAL `.gtdrc.json` seeding the
  default variables a fresh project usually changes (the test command) and a
  Prettier formatting suggestion (`modes:`). It writes NO `workflow:` key — gtd
  ships the unified workflow as its built-in default and runs it whenever none
  is configured, so a state command works out of the box with no init at all. A
  project customizes the machine itself only by adding a `workflow:` key. The
  written file is left UNCOMMITTED (the user reviews and commits it), and init
  refuses to clobber an existing config. Runs @live so the real config-detection
  (cosmiconfig over the real filesystem) is exercised.

  Scenario: gtd init writes an uncommitted minimal .gtdrc.json with default vars and modes
    Given a test project
    When I run gtd with args "init"
    Then it succeeds
    And stdout contains "Wrote .gtdrc.json"
    And stdout contains "built-in workflow"
    And stdout contains "commit"
    And ".gtdrc.json" exists
    And ".gtdrc.json" contains "\"$schema\""
    # Seeds the test command as a ready-to-edit top-level var.
    And ".gtdrc.json" contains "\"vars\""
    And ".gtdrc.json" contains "\"testCommand\""
    And ".gtdrc.json" contains "npm test"
    # A ready-to-edit top-level `modes:` block seeds a Prettier formatter for the
    # built-in qa/review steering-file modes (format only — gtd still validates).
    And ".gtdrc.json" contains "\"modes\""
    And ".gtdrc.json" contains "npx prettier --write"
    # No workflow is written — the machine is built in.
    And ".gtdrc.json" does not contain "\"workflow\""
    And ".gtdrc.json" does not contain "review-deciding"
    # No prompt files are extracted — the prompts live in the built-in workflow.
    And "gtd-prompts/planning.md" does not exist
    # Left uncommitted — HEAD is still the project's own initial commit.
    And the last commit subject is "chore: initial commit"

  Scenario: gtd init rejects a workflow argument
    Given a test project
    When I run gtd with args "init simple"
    Then it fails
    And stderr contains "too many arguments"
    And stderr contains "init takes no argument"
    And ".gtdrc.json" does not exist

  Scenario: gtd init refuses to overwrite an existing gtd config
    Given a test project
    And the workflow
    When I run gtd with args "init"
    Then it fails
    And stderr contains "already exists"

  # Regression: an ancestor/global config (e.g. ~/.gtdrc) must not block init —
  # the guard checks only the repo root, not the whole cwd→home walk.
  Scenario: gtd init succeeds when only an ancestor directory carries a gtd config
    Given a test project nested under a directory that already has a gtd config
    When I run gtd with args "init"
    Then it succeeds
    And stdout contains "Wrote .gtdrc.json"
    And ".gtdrc.json" exists
    And ".gtdrc.json" contains "\"testCommand\""

  # gtd ships a built-in default workflow, so a state command works with no
  # config at all — no init required.
  Scenario: a state command with no config runs on the built-in default workflow
    Given a test project
    When I run gtd status
    Then it succeeds
    And stdout contains "State: idle"
    And stdout contains "Awaits: human"

  # init writes only config — it derives no git state, so it may scaffold a
  # SHARED config in a plain parent directory that is not a repo. A nested repo
  # picks it up by walking up the cwd→home chain (see docs/configuration.md).
  Scenario: gtd init runs outside any git repository
    Given a plain directory that is not a git repository
    When I run gtd with args "init"
    Then it succeeds
    And stdout contains "Wrote .gtdrc.json"
    And stdout contains "not a git repository"
    And ".gtdrc.json" exists
    And ".gtdrc.json" contains "\"testCommand\""

  # But a repository SUBDIRECTORY is refused: gtd discovers config by walking UP
  # from the repo root, so a config written below the root would never be found.
  Scenario: gtd init refuses to scaffold into a repository subdirectory
    Given a subdirectory of a test project
    When I run gtd with args "init"
    Then it fails
    And stderr contains "subdirectory"
    And ".gtdrc.json" does not exist
