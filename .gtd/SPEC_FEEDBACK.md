# Spec feedback — 01 Replace the CGNAT bind with a managed `tailscale serve` front door

Everything else in the package checks out: `Serve.ts`'s four pieces and their
tests, `UiListener`'s two branches, the serve-first control flow with its
fallback line, the ownership record's orphan/teardown rules (unit AND `@live`
signal coverage), `npm test` green, `npm run deadcode` clean, `docs/cli.md` and
`docs/configuration.md` updated, no `ui.serve:` key, no module or function
deleted. Command shapes verified against the real CLI on this machine:
`tailscale serve --bg --https=<port> --set-path=/ http://127.0.0.1:<p>`,
`tailscale serve --https=<port> off` and the
`Web["<host>:<port>"].Handlers["/"] .Proxy` shape `parseServeStatus` reads all
behave as implemented.

## One criterion is not actually asserted: the OS-picked loopback port

Task 3's first acceptance bullet — "a working serve path listens on `127.0.0.1`
with an OS-picked port" — is only half covered. The happy-path test
(`src/ui/Server.test.ts#685`, "binds an ephemeral loopback port and prints the
probed tailnet hostname as the serve URL") captures `host` out of the fake
listener's options and asserts `boundHost === "127.0.0.1"`, but never captures
or asserts `port`. No other test does either: the only `port: 0` occurrences in
that file are the direct `UiListener.Live` tests (`#398`, `#444`) and a
`--host`-path `runUiCommand` case (`#1647`) — none of them the serve branch.

Consequence: changing `attemptServe`'s
`uiListener.listen({ host: "127.0.0.1", port: 0, handler })`
(`src/ui/Server.ts`) to pass `servePort` — or any other fixed port — keeps the
whole suite green, including the `@live` scenarios, because
`spawnGtdUiServeAndHandOff` dials whatever `targetPort` the ownership record
names and the fake `tailscale` CLI never binds the serve port itself. The
"nothing outside the machine dials it" ephemeral-target design has no test
defending it.

Fix: in that same happy-path test, capture `port` alongside `host` from the fake
listener and assert it is `0`. Asserting the written record's `targetPort`
equals the port the fake returned would additionally pin `attemptServe`'s
readback, which is likewise unasserted today.
