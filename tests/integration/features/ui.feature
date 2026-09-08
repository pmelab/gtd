Feature: gtd ui — the phone/web client's HTTPS listener

  `gtd ui` binds a long-lived HTTPS server exposing the phone/web client for
  THIS worktree — the invoking directory, never a configured list of roots.
  Unlike `gtd visualize`, `needs: "state"`: it shares the repo-root and
  at-least-one-commit guard with every other state command. It blocks forever
  on success — these scenarios only cover its deterministic, fast refusal
  paths, not a real bind: binding needs a real socket and, absent `--host`, a
  real Tailscale interface, neither of which this harness provides.

  @inmem
  Scenario: no --host and no tailnet refuses, naming both remedies
    Given a test project
    When I run gtd with args "ui"
    Then it fails
    And stderr contains "no Tailscale interface found to bind to, and no --host given"
    And stderr contains "join a tailnet"
    And stderr contains "or pass --host <address> to bind explicitly"

  @inmem
  Scenario: --host with no --self-signed and no configured cert/key refuses, naming both remedies
    Given a test project
    When I run gtd with args "ui --host 100.64.0.1"
    Then it fails
    And stderr contains "HTTPS is mandatory and no certificate is configured"
    And stderr contains "pass --self-signed for a throwaway certificate"
    And stderr contains "or configure ui.cert and ui.key"

  @inmem
  Scenario: a repository with no commits refuses through the shared repo guard, not gtd ui's own refusal — inverted from when gtd serve skipped this guard entirely
    Given a git repository with no commits
    When I run gtd with args "ui"
    Then it fails
    And stderr contains "gtd requires a repository with at least one commit"

  @inmem
  Scenario: --self-signed only unlocks generating a certificate, not the --host requirement
    Given a test project
    When I run gtd with args "ui --self-signed"
    Then it fails
    And stderr contains "no Tailscale interface found to bind to, and no --host given"

  @live
  Scenario: gtd ui outside a git repository refuses through the repo-root guard
    Given a plain directory that is not a git repository
    When I run gtd with args "ui"
    Then it fails
    And stderr contains "not a git repository"
