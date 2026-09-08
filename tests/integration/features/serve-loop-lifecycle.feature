@live
Feature: gtd serve's loop lifecycle as a real OS process

  `serve.feature`'s own `@inmem` scenarios only cover `gtd serve`'s fast,
  deterministic REFUSAL paths — a successful bind blocks forever
  (`Effect.never`), which an in-process `runCli` call can never return from.
  These scenarios spawn a REAL `gtd serve` subprocess instead, binding for
  real over loopback (`--host 127.0.0.1 --self-signed --port 0` needs no
  tailnet and no fixed port to collide on in CI), to pin what the `@inmem`
  tier structurally cannot: that it actually starts, and that a restart
  (SIGINT/SIGTERM, same as Ctrl-C) kills it cleanly rather than hanging or
  leaving an orphaned process. The `done`/`stop` tRPC round trip itself —
  spawning the configured loop command, registering it, killing it on
  shutdown — is exercised at the `Server.test.ts` unit tier instead (a real
  HTTPS listener, a real tRPC client, no `gtd` subprocess needed for that
  part), since scripting a full loop-command fixture through a cucumber step
  would duplicate that coverage without adding anything a live process
  boundary specifically proves.

  Scenario: gtd serve binds for real and exits 130 on SIGINT — the same signal Ctrl-C sends
    Given a test project
    When I send SIGINT to a spawned gtd serve
    Then the reported exit status is 130

  Scenario: gtd serve binds for real and exits 143 on SIGTERM
    Given a test project
    When I send SIGTERM to a spawned gtd serve
    Then the reported exit status is 143
