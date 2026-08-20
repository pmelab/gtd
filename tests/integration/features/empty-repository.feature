Feature: gtd in a repository with no commits yet

  A gtd process derives workflow state from git history, so every
  state-deriving command — `land`, `next`, `validate`, `abandon`,
  `restore`, and `--entry <state>` — requires a repository with at least one
  commit and refuses immediately, before emitting any script or touching
  anything, when there isn't one yet. The refusal states the requirement and
  the remedy verbatim and exits `1`; under `--json` the same message rides
  the `{"state":"error","prompt":…}` envelope on stderr (stdout stays
  byte-empty), still exiting `1`.

  `gtd status` is gone — it always usage-errors (exit `2`) before any
  precondition check runs at all, even in a commitless repository (see
  below), so it is no longer one of the state-deriving commands above.

  `gtd init` is exempt — it writes only config and derives no workflow state
  — so it still succeeds in a commitless repository, and its own next-steps
  message ("review and commit it") is exactly how a fresh project satisfies
  the precondition.

  @live
  Scenario: gtd land refuses in a repository with no commits
    Given a git repository with no commits
    And I record the commit count
    When I run gtd land
    Then it fails
    And the exit code is 1
    And stderr contains "gtd requires a repository with at least one commit — make an initial commit, then run gtd again"
    And the commit count is unchanged

  @inmem
  Scenario: gtd land refuses in a repository with no commits (scripted)
    Given a git repository with no commits
    And I record the commit count
    When I run gtd land
    Then it fails
    And the exit code is 1
    And stderr contains "gtd requires a repository with at least one commit — make an initial commit, then run gtd again"
    And the commit count is unchanged

  @inmem
  Scenario: gtd next refuses in a repository with no commits
    Given a git repository with no commits
    When I run gtd next
    Then it fails
    And the exit code is 1
    And stderr contains "gtd requires a repository with at least one commit — make an initial commit, then run gtd again"

  @inmem
  Scenario: gtd status is a removed-command usage error even in a repository with no commits
    # The removed-command check runs at parse time, ahead of any repository
    # precondition — so this is the same usage error command-surface.feature
    # asserts on everywhere else, not the commitless refusal above.
    Given a git repository with no commits
    When I run gtd status
    Then it fails
    And the exit code is 2
    And stderr contains "gtd: `gtd status` is gone — run `gtd next` instead"

  @inmem
  Scenario: gtd validate refuses in a repository with no commits
    Given a git repository with no commits
    When I run gtd with args "validate"
    Then it fails
    And the exit code is 1
    And stderr contains "gtd requires a repository with at least one commit — make an initial commit, then run gtd again"

  @inmem
  Scenario: gtd abandon refuses in a repository with no commits
    Given a git repository with no commits
    When I run gtd with args "abandon"
    Then it fails
    And the exit code is 1
    And stderr contains "gtd requires a repository with at least one commit — make an initial commit, then run gtd again"

  @inmem
  Scenario: gtd restore refuses in a repository with no commits
    Given a git repository with no commits
    When I run gtd with args "restore"
    Then it fails
    And the exit code is 1
    And stderr contains "gtd requires a repository with at least one commit — make an initial commit, then run gtd again"

  @inmem
  Scenario: gtd --entry <state> refuses in a repository with no commits
    Given a git repository with no commits
    When I run gtd with args "--entry review-gate.check"
    Then it fails
    And the exit code is 1
    And stderr contains "gtd requires a repository with at least one commit — make an initial commit, then run gtd again"

  @inmem
  Scenario: gtd land --json refuses in a repository with no commits, same envelope as gtd next --json
    # --json is now in scope for `gtd land` too (package 04), so this hits the
    # ordinary commitless-repo precondition, not a usage error: the
    # `{"state":"error",…}` envelope on stderr, stdout byte-empty, exit 1.
    Given a git repository with no commits
    When I run gtd land with "--json"
    Then it fails
    And the exit code is 1
    And stdout is empty
    And stderr contains "gtd requires a repository with at least one commit — make an initial commit, then run gtd again"
    And stderr contains "\"state\":\"error\""

  @live
  Scenario: gtd init is exempt — it still succeeds in a repository with no commits
    Given a git repository with no commits
    When I run gtd with args "init"
    Then it succeeds
    And stdout contains "Wrote .gtdrc.json"
    And stdout contains "commit"
