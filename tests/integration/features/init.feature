@live
Feature: gtd init — scaffold a .gtdrc.json from the bundled unified workflow

  `gtd init` (see src/program.ts) writes a `.gtdrc.json` carrying the bundled
  unified workflow template inline. It takes NO argument — gtd ships a single
  template and no default, so a state command run with no workflow configured
  fails with a pointer back to `gtd init`. The written file is left UNCOMMITTED
  (the user reviews and commits it), and init refuses to clobber an existing
  config. Runs @live so the real config-detection (cosmiconfig over the real
  filesystem) is exercised.

  Scenario: gtd init writes an uncommitted .gtdrc.json with the unified workflow inline
    Given a test project
    When I run gtd with args "init"
    Then it succeeds
    And stdout contains "Wrote .gtdrc.json"
    And stdout contains "gtd-prompts/"
    And stdout contains "commit"
    And ".gtdrc.json" exists
    And ".gtdrc.json" contains "\"$schema\""
    And ".gtdrc.json" contains "\"workflow\""
    And ".gtdrc.json" contains "review-deciding"
    # Both entry points and the advanced machinery live in the one template.
    And ".gtdrc.json" contains "adv-grilling"
    And ".gtdrc.json" contains "decompose"
    And ".gtdrc.json" contains "spec-review"
    And ".gtdrc.json" contains "squashing"
    # A ready-to-edit top-level `modes:` block seeds a Prettier formatter for the
    # built-in qa/review steering-file modes (format only — gtd still validates).
    And ".gtdrc.json" contains "\"modes\""
    And ".gtdrc.json" contains "npx prettier --write"
    # Left uncommitted — HEAD is still the project's own initial commit.
    And the last commit subject is "chore: initial commit"

  # Each agent state's prompt is extracted to gtd-prompts/<state>.md and the
  # config references it via a ./ file reference; human messages and check
  # scripts stay inline in the config.
  Scenario: gtd init extracts agent prompts to gtd-prompts/ and references them
    Given a test project
    When I run gtd with args "init"
    Then it succeeds
    And "gtd-prompts/grilling.md" exists
    And "gtd-prompts/grilling.md" contains "autonomous coding agent"
    And "gtd-prompts/building.md" exists
    And "gtd-prompts/fixing.md" exists
    And "gtd-prompts/reviewing.md" exists
    And "gtd-prompts/architecting.md" exists
    And "gtd-prompts/decompose.md" exists
    And "gtd-prompts/spec-review.md" exists
    And "gtd-prompts/squashing.md" exists
    And ".gtdrc.json" contains "./gtd-prompts/grilling.md"
    # idle is a human message, checking is a script — both stay inline.
    And "gtd-prompts/idle.md" does not exist
    And "gtd-prompts/checking.md" does not exist
    And ".gtdrc.json" contains "No active gtd cycle"

  # The extracted files are LIVE: gtd inlines them at load time, so editing a
  # prompt file changes the workflow with no config edit.
  Scenario: the workflow resolves an edited prompt file at runtime
    Given a test project
    When I run gtd with args "init"
    Then it succeeds
    Given "gtd-prompts/grilling.md" is modified to:
      """
      SENTINEL edited grilling prompt body
      """
    And the working tree is committed
    And a file ".gtd/TODO.md" with:
      """
      build a small widget
      """
    When I run gtd step human
    Then it succeeds
    When I run gtd next
    Then stdout contains "SENTINEL edited grilling prompt body"

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
    And ".gtdrc.json" contains "\"workflow\""

  Scenario: a state command with no workflow configured fails with the init hint
    Given a test project
    When I run gtd status
    Then it fails
    And stderr contains "no workflow configured"
    And stderr contains "gtd init"
