# Spec feedback — 01 Tailscale serve front door

One unmet acceptance criterion. Everything else in Tasks 1–4 checks out:
`Serve.ts`'s four pieces and all five T1 bullets, `UiListener`'s tls/plain split
with real loopback binds, serve-first control flow with printed fallback reason,
and all six T4 ownership guarantees (foreign mapping, dead pid, target mismatch,
probe-failed, SIGINT/SIGTERM/handoff teardown). Command shapes verified against
the real CLI on this machine:
`tailscale serve --bg --https=<port> --set-path=/ http://127.0.0.1:<port>`
publishes and `--https=<port> off` removes it, and `serve status --json`'s
`Web["<host>:<port>"].Handlers["/"].Proxy` is the un-normalized target URL
`parseServeStatus` and `teardownServe`'s equality check assume.

## T3 bullet 3 is unproven, and its e2e scaffolding is wired to nothing

Criterion: "a failing `publishServe` still yields a reachable direct bind and
exit code 0 on the eventual handoff — never a refusal."

Nothing asserts either half.

- `src/ui/Server.test.ts:866` ("tailscale serve itself fails to publish")
  asserts only the two printed lines, then `Fiber.interrupt`s. No exit code, and
  its listener is a fake returning `{ port: 4443 }` — no socket is bound, so
  "reachable" is not tested.
- `tests/integration/support/hooks.ts:77` defines a `fail-publish` marker
  (`$GTD_TEST_TAILSCALE_DIR/fail-publish`, documented at hooks.ts:68 as being
  for "the 'publishServe itself fails' fallback scenario") that makes the fake
  `tailscale serve --bg` exit 1. **No step definition and no scenario ever
  writes that file** — `grep -rn fail-publish tests/` hits only hooks.ts itself.
  The branch is dead test scaffolding.
- `tests/integration/features/ui.feature` is listed under T3's Paths and carries
  no serve scenario at all — the serve-path e2e proof lives entirely in
  `ui-lifecycle.feature`, and the publish-failure case is absent there too.

Fix: an `@live` scenario that arms the existing marker before spawning `gtd ui`
on the serve path, then asserts (a) the fallback reason line, (b) a real HTTPS
request against the printed direct-bind URL succeeds, and (c) the handoff exits
0 — i.e. the publish-failure twin of `ui-lifecycle.feature:240`'s serve/handoff
scenario, driven through `world.ts#spawnBoundGtdUiServe`. A `Given` step arming
the marker keeps it composable, per AGENTS.md's generic-Given rule.
