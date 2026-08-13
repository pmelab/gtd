Feature: gtd in a repository with no commits yet

  A gtd process derives workflow state from git history, so every
  state-deriving command — `land`, `next`, `status`, `validate`, `abandon`,
  `restore`, and `--entry <state>` — requires a repository with at least one
  commit and refuses immediately, before emitting any script or touching
  anything, when there isn't one yet. The refusal states the requirement and
  the remedy verbatim and exits `1`; under `--json` the same message rides
  the `{"state":"error","prompt":…}` envelope on stdout, still exiting `1`.

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
  Scenario: gtd status refuses in a repository with no commits
    Given a git repository with no commits
    When I run gtd status
    Then it fails
    And the exit code is 1
    And stderr contains "gtd requires a repository with at least one commit — make an initial commit, then run gtd again"

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
  Scenario: gtd land --json carries the refusal on stdout as a "state":"error" envelope
    Given a git repository with no commits
    When I run gtd land with "--json"
    Then it fails
    And the exit code is 1
    And stdout contains "{\"state\":\"error\",\"prompt\":\"gtd requires a repository with at least one commit — make an initial commit, then run gtd again\"}"

  @live
  Scenario: gtd init is exempt — it still succeeds in a repository with no commits
    Given a git repository with no commits
    When I run gtd with args "init"
    Then it succeeds
    And stdout contains "Wrote .gtdrc.json"
    And stdout contains "commit"
