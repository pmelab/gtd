# Spec feedback — 01-tailscale-serve-front-door

The three problems from the previous round are all fixed:
`probeLiveServeMapping` now distinguishes a failed probe from an empty one on
the PUBLISH side (`Server.ts#470`–#483, `clearOrphanForPublish` returns `false`
on `!probe.ok`), two dedicated serve-path signal scenarios exist
(`ui-lifecycle.feature:107` and `:148`, spawned without `--host`/`--self-signed`
via `spawnGtdUiServeAndSignal`), and `src/Cli.ts`, `docs/cli.md`,
`docs/configuration.md` all describe the serve front door. `npm run deadcode` is
clean; `Bind.ts`, `BindSystem.ts`, `Tls.ts` all stay referenced.

Two things are still wrong.

## 1. The same failed-probe asymmetry survives on the TEARDOWN side — a failed probe orphans OUR mapping permanently

`teardownServe` (`src/ui/Server.ts#593`–#602):

```ts
const probe = yield* probeLiveServeMapping(servePort)
if (probe.ok && probe.mapping !== undefined && probe.mapping.targetUrl === record.target) {
  yield* unpublishServe(servePort)...
}
deleteServeRecord(servePort)
```

`deleteServeRecord` is unconditional. When `probe.ok === false` — exactly the
case the publish side was just fixed to treat as "proves nothing" — the record
is destroyed and the mapping is left up. Task 4 authorises deleting without
unpublishing for one case only: "A record whose `target` no longer matches the
live mapping is deleted without unpublishing — someone else took the port over."
A probe that never answered is not that case; nothing was observed to have taken
the port over.

Failure scenario: `gtd ui` publishes on 8443 and writes
`~/.gtd/serve/8443.json`. At exit, `tailscale serve status --json` exits
non-zero (tailscaled restarting, operator permission lost mid-teardown). Record
deleted, mapping left pointing at a loopback port that dies one millisecond
later. Now the state is a live tailnet mapping on 8443 with no record — which
the (correct) orphan check treats as foreign forever. Every later `gtd ui`
prints "port 8443 already carries a tailscale serve mapping this instance does
not own" and falls back to the direct bind, and the tailnet keeps serving a dead
port at `https://<host>:8443/` until the operator runs
`tailscale serve --https=8443 off` by hand. The teardown guarantee the whole
ownership record exists to provide is silently voided by one flaky probe.

No test covers it: `Server.test.ts:1146` covers the target-mismatch case, and
nothing drives `teardownServe` with a failing probe.

## 2. The serve e2e scenarios write to the developer's REAL `$HOME`, not the sandbox

`world.ts#spawnEnv` (`:380`–#391) spreads `process.env` and overrides only
`PATH`, `GTD_TESTCOMMAND`, `GTD_TEST_TAILSCALE_DIR`, `NODE_OPTIONS`. `HOME` is
inherited, and `Serve.ts#serveDir` is `join(homedir(), ".gtd", "serve")` — so
the four `@live` serve scenarios (ports 18443/18444/18445/18446) create and
delete files in the real user's home directory. `world.ts:642` and
`ui-lifecycle.steps.ts:19` assert against that same real path. The fake
`tailscale` CLI's own state IS sandboxed (`GTD_TEST_TAILSCALE_DIR`, a mkdtemp
dir cleaned in `hooks.ts#cleanupLiveTier`); the ownership record is the one
piece that escapes, and nothing in `cleanupLiveTier` removes it.

Failure scenario: a serve scenario is interrupted (Ctrl-C on the suite, a vitest
timeout killing the child before `Effect.ensuring` finishes). A record naming
that dead pid is left at `~/.gtd/serve/18443.json`. The OS later reuses that pid
for any long-lived process. The next suite run's `clearOrphanForPublish` reads
the record, `isPidAlive(record.pid)` is true and the pid is not ours, so it
returns `false` → no publish → direct-bind fallback → `spawnBoundGtdUiServe`
finds no ownership record and the scenario fails with "no ownership record found
at ~/.gtd/serve/18443.json", on a machine where nothing is wrong with the code.
The suite is not hermetic, and its state survives its own cleanup.

Note the constraint on any fix: overriding `HOME` for the spawned `gtd ui`
changes what git reads for global config in the same subprocess, so a fix has to
keep the live-tier git behaviour these scenarios already depend on intact.
