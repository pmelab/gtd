@live
Feature: gtd init — seed a minimal .gtdrc.json (formatting)

  `gtd init` writes a MINIMAL `.gtdrc.json` with a Prettier formatting
  suggestion (`modes:`). It seeds no setting — a workflow's settings are its
  own — and writes no workflow: the workflows live in `gtd.config.ts`, which
  `gtd install` scaffolds. The written file is left UNCOMMITTED (the user
  reviews and commits it), and init refuses to clobber an existing config. Live
  tier, so the real config detection over the real filesystem is exercised.

  Scenario: gtd init writes an uncommitted minimal .gtdrc.json with formatting modes
    Given a test project
    When I run gtd with args "init"
    Then it succeeds
    And stdout contains "Wrote .gtdrc.json"
    And stdout contains "gtd install"
    And stdout contains "commit"
    And ".gtdrc.json" exists
    And ".gtdrc.json" contains "\"$schema\""
    And ".gtdrc.json" does not contain "\"env\""
    And ".gtdrc.json" does not contain "\"vars\""
    # A ready-to-edit top-level `modes:` block seeds a Prettier formatter for the
    # built-in qa/review steering-file modes (format only — gtd still validates).
    And ".gtdrc.json" contains "\"modes\""
    And ".gtdrc.json" contains "npx prettier --write"
    # No workflow is written — that is gtd.config.ts's job.
    And ".gtdrc.json" does not contain "\"workflow\""
    And ".gtdrc.json" does not contain "build.review.deciding"
    # No prompt files are extracted.
    And "gtd-prompts/planning.md" does not exist
    # Left uncommitted — HEAD is still the project's own initial commit, and
    # the scaffolded file itself is untracked, not staged.
    And the last commit subject is "chore: initial commit"
    And the git status contains "?? .gtdrc.json"

  Scenario: gtd init rejects a workflow argument
    Given a test project
    When I run gtd with args "init simple"
    Then it fails
    And stderr contains "too many arguments"
    And ".gtdrc.json" does not exist

  Scenario: gtd init refuses to overwrite an existing gtd config
    Given a test project
    And the workflow gtd install scaffolds
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
    And ".gtdrc.json" contains "\"modes\""

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
    And ".gtdrc.json" contains "\"modes\""

  # But a repository SUBDIRECTORY is refused: gtd discovers config by walking UP
  # from the repo root, so a config written below the root would never be found.
  Scenario: gtd init refuses to scaffold into a repository subdirectory
    Given a subdirectory of a test project
    When I run gtd with args "init"
    Then it fails
    And stderr contains "subdirectory"
    And ".gtdrc.json" does not exist
