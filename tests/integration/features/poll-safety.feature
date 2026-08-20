@live
Feature: Reads are safe to poll — a settled rest answers identically and mutates nothing

  `gtd next` and `gtd status` must be safe to poll: nothing may move between
  the run that reports a rest and any following call. Session id and resume
  are a pure derivation of history and write nothing, and no command records
  that a beat was dispatched — largely guaranteed already, but a gap in
  proof. These scenarios assert it directly against the git dir itself, at
  both a resting PROMPT turn (where `gtd next --json` derives
  `session`/`memory`/`model` — the very properties the requirement names —
  the one structured surface gtd has now, see AGENTS.md)
  and a resting human GATE, so a future change cannot quietly reintroduce a
  driver-scoped write at either shape. A third scenario is a negative
  control: without it, the snapshot helper could stop observing anything at
  all and every "unchanged" assertion above would still pass vacuously.
  `@live` only: the in-memory tier has no git dir to observe a write against.

  Scenario: repeated reads at a resting prompt turn change nothing — session, memory, and model all stay put
    Given a test project
    And the workflow
    When I run gtd with args "--entry design.triage"
    Then it succeeds
    And the git index has settled
    And I snapshot the repository
    When I run gtd next with "--json"
    Then it succeeds
    And I record stdout as "status-1"
    And stdout contains "\"session\":"
    And stdout contains "\"memory\":"
    And stdout contains "\"model\":"
    When I run gtd next with "--json"
    Then it succeeds
    And I record stdout as "status-2"
    Then stdout recorded as "status-1" is byte-identical to stdout recorded as "status-2"
    And the repository snapshot is unchanged

  Scenario: repeated reads at a settled gate change nothing
    Given a test project
    And the workflow
    When I run gtd with args "--entry design.gate.answer"
    Then it succeeds
    And the git index has settled
    And I snapshot the repository
    When I run gtd next with "--json"
    Then it succeeds
    And I record stdout as "status-1"
    When I run gtd next
    Then it succeeds
    And I record stdout as "next-1"
    When I run gtd next with "--json"
    Then it succeeds
    And I record stdout as "status-2"
    When I run gtd next
    Then it succeeds
    And I record stdout as "next-2"
    Then stdout recorded as "status-1" is byte-identical to stdout recorded as "status-2"
    And stdout recorded as "next-1" is byte-identical to stdout recorded as "next-2"
    And the repository snapshot is unchanged

  Scenario: negative control — the snapshot helper actually detects a real write
    Given a test project
    And the git index has settled
    And I snapshot the repository
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    And the repository snapshot has changed
