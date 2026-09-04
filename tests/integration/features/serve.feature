@inmem
Feature: gtd serve — the phone/web client's HTTPS listener

  `gtd serve` binds a long-lived HTTPS server exposing the phone/web client.
  Like `gtd visualize`, `needs: "config"` skips the repo-root guard, so it
  runs from any directory (even one with no commits) and touches no
  git/HEAD/review-window. It blocks forever on success — these scenarios only
  cover its deterministic, fast refusal paths, not a real bind: binding needs
  a real socket and, absent `--host`, a real Tailscale interface, neither of
  which this harness provides.

  Scenario: no --host and no tailnet refuses, naming both remedies
    Given a test project
    When I run gtd with args "serve"
    Then it fails
    And stderr contains "no Tailscale interface found to bind to, and no --host given"
    And stderr contains "join a tailnet"
    And stderr contains "or pass --host <address> to bind explicitly"

  Scenario: --host with no --self-signed and no configured cert/key refuses, naming both remedies
    Given a test project
    When I run gtd with args "serve --host 100.64.0.1"
    Then it fails
    And stderr contains "HTTPS is mandatory and no certificate is configured"
    And stderr contains "pass --self-signed for a throwaway certificate"
    And stderr contains "or configure serve.cert and serve.key"

  Scenario: serve needs no repository — a repo with no commits still reaches serve's own refusal, not a repo guard
    Given a git repository with no commits
    When I run gtd with args "serve"
    Then it fails
    And stderr contains "no Tailscale interface found to bind to, and no --host given"

  Scenario: --self-signed only unlocks generating a certificate, not the --host requirement
    Given a test project
    When I run gtd with args "serve --self-signed"
    Then it fails
    And stderr contains "no Tailscale interface found to bind to, and no --host given"
