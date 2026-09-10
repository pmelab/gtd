# 01 — Replace the CGNAT bind with a managed `tailscale serve` front door

## Requirement

Binding a raw socket to the tailnet IP is the wrong reachability model. It works
on a direct LAN path and fails over a DERP relay, so `gtd ui` is reachable from
home and unreachable from outside. Replace it: listen on loopback, then publish
`tailscale serve --bg --https=<port> --set-path=/ <target>` and let tailscaled
terminate TLS.

Serve accepts any port — the 443/8443/10000 restriction is Funnel-only — so one
mapping per instance is fine.

`HttpsServer.listen` (`src/ui/Server.ts#158`–`#191`) creates an
`https.createServer` unconditionally; there is no plain-HTTP path in the
codebase at all. Serve terminates TLS itself, so a plain-HTTP loopback listener
has to be added — it is part of this requirement, not a detail, and it is the
one piece with no existing code to copy.

Three properties are mandatory, not optional polish:

- An ownership record, so teardown removes only a mapping this instance
  published. Serve config is node-global: without it one instance rips out
  another's mapping, or another tool's own port-443 door.
- Teardown on every exit path, plus an orphan check on start. A crash otherwise
  leaves a mapping pointing at a dead port while the printed URL still looks
  valid. The existing SIGINT-exit-130 and handoff-exit paths both count.
- A fallback to today's direct bind when serve fails — operator not set, or no
  tailnet HTTPS certs available — rather than refusing to start.

The payoff is dead code: the CGNAT scan (`isTailscaleIPv4`, `pickBindHost`),
`resolveBindHost`'s "no Tailscale interface found to bind to" refusal,
`tailscale cert`/`obtainTailscaleCert`, and the self-signed branch all become
unreachable on the primary path. The fallback keeps the direct bind itself
alive, so delete only what the fallback no longer reaches — **which, as designed
below, is nothing. This package deletes no module and no function.**

`--host`/`ui.host` is the only opt-out. No `ui.serve:` key is added, so
`src/ConfigSchema.ts`'s four `ui:` keys and the generated `schema.json` are
untouched.

Risk: the reference implementation named in the design discussion (another tool
already publishing through `tailscale serve`) is not present on this machine, so
every command shape below is derived from `tailscale serve`'s own CLI, not read
off working code. Verify each invocation against `tailscale serve --help` before
pinning a test to its exact string.

## Task 1 — `src/ui/Serve.ts`: the serve port and its ownership record

New module mirroring `src/ui/Tailscale.ts`'s split — pure parse functions plus
thin `CommandRunner`-backed Effects. No new service tag: every `tailscale`
invocation goes through `CommandRunner.bash`, exactly as `probeTailscaleStatus`
(`src/ui/Tailscale.ts#54`) and `obtainTailscaleCert` already do, so the `@inmem`
tier keeps scripting them.

Four exported pieces:

- `parseServeStatus(json, servePort)` — pure, over
  `tailscale serve status --json`. Yields the mapping currently published on
  `servePort` and its target URL, or `undefined` for unparseable JSON, no serve
  config, or no mapping on that port. `undefined` is never a failure — the same
  rule `parseTailscaleStatus` already sets for an empty probe.
- `publishServe({ servePort, targetPort })` — runs
  `tailscale serve --bg --https=<servePort> --set-path=/ http://127.0.0.1:<targetPort>`,
  yielding `{ ok: true }` or `{ ok: false, reason, output }`. A non-zero exit is
  a VALUE, never an Effect failure: Task 3's fallback consumes it.
- `unpublishServe(servePort)` — `tailscale serve --https=<servePort> off`.
- The ownership record's read / write / delete, at
  `~/.gtd/serve/<servePort>.json`, holding
  `{ pid, servePort, targetPort, target, worktree }`. There is no other gtd
  state directory; create it on demand.

Paths: `src/ui/Serve.ts`, `src/ui/Serve.test.ts`.

- [ ] `parseServeStatus` returns `undefined` for each of: unparseable JSON, a
      valid payload with no serve config, and a valid payload whose mappings do
      not include `servePort` — three separate unit tests, none of them failing
      an Effect
- [ ] `parseServeStatus` returns the target URL for a payload that does carry a
      mapping on `servePort`
- [ ] `publishServe` yields `{ ok: false, reason, output }` — never a failed
      Effect — for a scripted non-zero exit, and the `output` carries the
      command's own stderr text verbatim
- [ ] the record round-trips: write then read yields the same five fields, and
      read on a missing file yields `undefined` rather than throwing
- [ ] the record path is `~/.gtd/serve/<servePort>.json` and its parent
      directory is created when absent

## Task 2 — One listener tag that can serve plain HTTP

`HttpsServer` (`src/ui/Server.ts#158`) becomes `UiListener`: one tag, one
method, `listen({ tls?: CertPair, host, port, handler })`. `tls` present →
`https.createServer` with today's exact options (`#176`); `tls` absent →
`http.createServer`. Every other line of that Live layer — the `EADDRINUSE`
mapping (`#178`–`#185`), the `error`-once handler, the bound-port readback
(`#186`–`#190`) — is untouched.

One method, not two, so `src/ui/Server.test.ts`'s fake stays a single function.
Its call site at `src/ui/Server.ts#579` moves to the options object.

Paths: `src/ui/Server.ts`, `src/ui/Server.test.ts`.

- [ ] `UiListener.listen` with no `tls` binds a server that answers a plain
      `http://` request, asserted against a real loopback bind
- [ ] `UiListener.listen` with `tls` behaves exactly as today: same TLS options,
      same `EADDRINUSE` → `gtd ui: port <port> is already in use` message, same
      bound-port readback for `port: 0`
- [ ] `src/ui/Server.test.ts` declares exactly one fake listener function, and
      no test references a tag named `HttpsServer`
- [ ] `npm test` green

## Task 3 — Serve-first control flow in `runUiCommand`, direct bind as fallback

Replaces `resolveHostsAndCert` (`src/ui/Server.ts#416`) as the entry point of
host resolution:

1. An explicit `--host` or `ui.host` means the operator chose a bind address —
   skip serve entirely, take today's direct-bind path unchanged. Same for
   `--self-signed`.
2. Otherwise: probe `tailscale serve status`, run Task 4's orphan check,
   `listen({ host: "127.0.0.1", port: 0 })` — an ephemeral target port, since
   nothing outside the machine dials it — then `publishServe` on
   `--port`/`ui.port` (default 8443). Print `https://<hostname>/`, or
   `https://<hostname>:<servePort>/` when the serve port is not 443, with the
   hostname from `probeTailscaleStatus`.
3. A failure at any step in 2 — no operator, serve unsupported, no tailnet HTTPS
   certs, a foreign mapping on the port — closes the loopback listener, prints
   one line naming why, and runs today's direct bind (`resolveBindHost` +
   `resolveCertPair` + a TLS `listen`) instead. It never refuses.

`isTailscaleIPv4`, `pickBindHost` (`src/ui/Bind.ts`), `pickBindHostFromSystem`
(`src/ui/BindSystem.ts`), `resolveBindHost` and its "no Tailscale interface
found to bind to" refusal (`src/ui/Server.ts#70`), `resolveCertPair` (`#100`),
`obtainTailscaleCert`, `generateSelfSignedCert` all stay — steps 1 and 3 reach
every one of them. The `GtdUsageError`/exit-code surface is unchanged: the
no-tailnet refusal now fires only on the fallback path, strictly rarer, never
new.

Paths: `src/ui/Server.ts`, `src/ui/Server.test.ts`,
`tests/integration/features/ui.feature`.

- [ ] a working serve path listens on `127.0.0.1` with an OS-picked port and
      prints the serve hostname — never a `100.64.0.0/10` address
- [ ] `--host <address>` and `--self-signed` each skip serve entirely: no
      `tailscale serve` invocation at all, and the printed URL is today's exact
      URL
- [ ] a failing `publishServe` still yields a reachable direct bind and exit
      code 0 on the eventual handoff — never a refusal
- [ ] the fallback prints one line naming why serve was not used, above the URL
- [ ] `npm run deadcode` reports no unreferenced module: `Bind.ts`,
      `BindSystem.ts` and `Tls.ts` all remain reachable
- [ ] the exit-code table is unchanged — no new number, no number removed

## Task 4 — Ownership: teardown on every exit, orphan clearing on start

The record from Task 1 is the whole basis of both guarantees.

**Teardown removes only our own mapping.** Before `unpublishServe`, re-read the
record and `parseServeStatus`; unpublish only when the record exists AND the
live mapping's target equals the record's `target`. A mapping we did not publish
has no record and is left untouched. A record whose target no longer matches the
live mapping is deleted without unpublishing — someone else took the port over.

**Orphan clearing on start.** Before publishing, read the record for our serve
port. No record but a live foreign mapping on that port → do not publish, fall
back to the direct bind, never overwrite. A record whose `pid` is dead, or is
our own → `unpublishServe`, delete the record, publish fresh. `pid` liveness is
`process.kill(pid, 0)`.

**Teardown rides the finalizer that already closes the socket:**
`Deferred.await(handoffDeferred).pipe(Effect.ensuring(...))`
(`src/ui/Server.ts#583`) gains the unpublish alongside `bound.close()`. That
covers the handoff exit and both signal exits, because `runMain` interrupts the
fiber and `ensuring` finalizers run on interrupt — a claim under test here, not
an assumption. A `SIGKILL` is not coverable and is exactly what the orphan check
exists for.

Paths: `src/ui/Server.ts`, `src/ui/Serve.ts`,
`tests/integration/features/ui-lifecycle.feature`.

- [ ] the handoff exit leaves no mapping on the serve port and no record file
- [ ] the existing SIGINT-exit-130 scenario additionally asserts no mapping and
      no record file survive, and still asserts exit 130
- [ ] the existing SIGTERM-exit-143 scenario asserts the same, and still asserts
      exit 143
- [ ] a foreign mapping on the serve port (no record file) survives a full start
      and exit untouched, and that start took the direct-bind fallback
- [ ] a record naming a dead `pid` is cleared on start — the stale mapping is
      unpublished, the record deleted, and a fresh mapping published
- [ ] a record whose `target` no longer matches the live mapping is deleted
      WITHOUT unpublishing that mapping
