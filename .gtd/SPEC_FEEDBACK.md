# Spec feedback — 01-tailscale-serve-front-door

Task 1, Task 2, Task 3 and most of Task 4 check out. Command shapes were
verified against the real CLI on this machine
(`tailscale serve --bg --https=18999 --set-path=/ 'http://127.0.0.1:12345'`
exits 0; `tailscale serve status --json` returns exactly the
`Web["<host>:<port>"].Handlers["/"].Proxy` shape `parseServeStatus` reads;
`tailscale serve --https=18999 off` removes it and leaves the pre-existing :443
mapping untouched). `npm test` is green, `npm run deadcode` reports nothing
unreferenced, and the new `@live` serve scenario passes.

Three things are wrong.

## 1. Task 4's SIGINT and SIGTERM criteria are not met — nothing was changed

Two checkboxes ask for it explicitly:

- "the existing SIGINT-exit-130 scenario additionally asserts no mapping and no
  record file survive, and still asserts exit 130"
- "the existing SIGTERM-exit-143 scenario asserts the same, and still asserts
  exit 143"

`git diff 233c7470..HEAD -- tests/integration/features/ui-lifecycle.feature`
adds one scenario (53 insertions, 0 deletions) and touches neither signal
scenario. `ui-lifecycle.feature:16` and `:56` still end at
`Then the reported exit status is 130` / `143` with no mapping or record
assertion.

Worse, they cannot be met by bolting the assertion on: both go through
`world.ts#spawnBoundGtdUi`, which spawns
`gtd ui --host 127.0.0.1 --self-signed --port 0` (`world.ts:548`). `--host` plus
`--self-signed` takes step 1 of Task 3 and skips serve entirely, so the record
and mapping are never created and an assertion that they are absent passes
vacuously. The signal path needs a serve spawn (no `--host`, no `--self-signed`)
— the shape `spawnGtdUiServeAndHandOff` already has.

This leaves the spec's one flagged claim untested at the e2e tier: "`runMain`
interrupts the fiber and `ensuring` finalizers run on interrupt — a claim under
test here, not an assumption." The only thing asserting it today is
`Fiber.interrupt` in `Server.test.ts:1034`, which exercises the Effect
finalizer, not `runMain`'s signal handling in a real OS process.

## 2. User-facing docs and `gtd ui --help` still describe the old reachability model

Three surfaces now state things the code no longer does. Two of them are
pinned/tested views, so they are not merely stale prose:

- `src/Cli.ts:492` — "Start a local HTTPS server (never plain http — a phone
  client reachable over a tailnet gets TLS on its own merits)". On the primary
  path the listener is now plain HTTP on loopback; `tailscaled` terminates TLS.
  This string is rendered into `docs/cli.md`'s `## Commands` block, which
  AGENTS.md pins equal to the help output — the line is wrong in both places
  (`docs/cli.md:77`).
- `docs/configuration.md:60`–`63` — `ui.host` "Default: a Tailscale interface (a
  CGNAT `100.64.0.0/10` address), auto-detected; with neither this key nor
  `--host` given and no such interface present, `gtd ui` refuses rather than
  silently binding to every interface on the LAN". Both halves are now false by
  design: the default is a `tailscale serve` front door on loopback, and Task 3
  step 3 guarantees it never refuses — it falls back. `ui.port` "the port to
  bind" is also wrong on the serve path, where it is the serve port and the bind
  port is OS-picked.
- `docs/cli.md:83`–`84` and `:152`–`153` — `--host` "default: an address picked
  automatically, using the detected Tailscale hostname when available". `--host`
  is now the documented opt-out from serve, per the spec's "`--host`/`ui.host`
  is the only opt-out".

## 3. A failed `tailscale serve status` probe lets the orphan check publish over a foreign mapping

`Server.ts#readLiveServeMapping` maps a spawn failure and any non-zero exit to
`undefined`, and `clearOrphanForPublish`'s no-record branch returns
`live === undefined` — i.e. "safe to publish". So an unreadable serve status is
indistinguishable from an empty one, and gtd publishes over a mapping it could
not see.

Failure scenario: another tool holds `--https=8443`,
`tailscale serve status --json` exits non-zero (operator not set for this user,
a `tailscaled` restart mid-probe), no record file exists →
`clearOrphanForPublish` returns `true` → `publishServe` overwrites the foreign
mapping. That is the exact case Task 4's "No record but a live foreign mapping
on that port → do not publish, fall back to the direct bind, never overwrite"
exists to prevent. The `undefined`-is-never-a-failure rule the spec sets is
about `parseServeStatus`'s PARSE, not about a probe that failed to run — a
failed probe should read as "cannot prove the port is free" and fall back.
