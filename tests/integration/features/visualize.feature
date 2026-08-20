@inmem
Feature: gtd visualize — an interactive diagram of the active workflow

  `gtd visualize` serves a local web page rendering the active workflow (the
  main flow, its sub-machines, and per-state details — see src/Visualize.ts).
  `--json` is gone from `visualize` — like every command but `gtd next`, it
  now usage-errors on `--json` (see command-surface.feature's generic
  outline); there is no JSON replacement for inspecting the model. The command
  reads the config but touches no git/HEAD/review-window, and owns its own
  `--port`/`--no-open` options.

  Scenario: --json is a usage error and authors nothing
    Given a test project
    And I record the commit count
    When I run gtd with args "visualize --json"
    Then it fails
    And stderr contains "only valid for `gtd next`"
    And the commit count is unchanged

  Scenario: an unknown option is rejected (no server is started)
    Given a test project
    When I run gtd with args "visualize --bogus"
    Then it fails
    And stderr contains "unknown option"

  Scenario: an unexpected positional argument is rejected
    Given a test project
    When I run gtd with args "visualize bogus"
    Then it fails
    And stderr contains "too many arguments"

  Scenario: an invalid --port is rejected
    Given a test project
    When I run gtd with args "visualize --port abc"
    Then it fails
    And stderr contains "--port must be an integer"
