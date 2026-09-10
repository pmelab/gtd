# Package 01 — spec feedback

Everything else in the package checks out: `Serve.ts`'s four exported pieces and
all five Task 1 criteria, `UiListener`'s tls/no-tls split with the untouched
`EADDRINUSE` mapping and bound-port readback, the serve-first/direct-bind
control flow, both ownership guarantees, the `ui-lifecycle.feature` signal and
handoff scenarios, `npm run deadcode` (0 dead files, 0 dead exports —
`Bind.ts`/`BindSystem.ts`/`Tls.ts` all reachable), the unchanged four `ui:`
config keys, and the unchanged exit-code table. The command shapes were also
verified against the real CLI on this machine (`tailscale` 1.102.3):
`tailscale serve --bg --https=<p> --set-path=/ 'http://127.0.0.1:<t>'`,
`tailscale serve --https=<p> off`, and the `Web`/`Handlers`/`Proxy` JSON shape
`parseServeStatus` reads all behave exactly as implemented.

One problem.

## The happy-path unit test runs against the production serve port in the REAL home directory

`src/ui/Server.test.ts:670` ("no --host/ui.host given: attempts tailscale serve
first…") calls `runUiCommand({ selfSigned: false, dev: false }, …)` with **no
`port`**, so `runUiCommand` resolves `DEFAULT_PORT` = 8443 and the whole Task 4
record path runs against the real `~/.gtd/serve/8443.json` — `homedir()`, not a
sandbox. `CommandRunner` is faked, so no real `tailscale` mutation happens, but
the record file is real: running the unit suite on this machine already created
`~/.gtd/serve/` in the user's actual home directory.

Two concrete failures, both from a real `gtd ui` being up on the default port
while the suite runs:

- Its record names a LIVE foreign pid → `clearOrphanForPublish` returns `false`
  → `attemptServe` returns `ok: false` → the test takes the direct-bind
  fallback, and `expect(boundHost).toBe("127.0.0.1")` fails against the CGNAT
  bind host. A flaky red with no relation to the code under test.
- Its record names a DEAD pid (the crash case the orphan check exists for) → the
  test's own `deleteServeRecord(8443)` erases that record, and its teardown
  deletes the one it wrote in place. The real orphaned mapping on 8443 is then
  permanently unownable — exactly the leak Task 4 is built to prevent.

The fix is the convention the file's own neighbours already set, and it is one
line: pass an explicit dedicated port, the way the Task 4 describe block does
(`orphanPort = 18444`, whose comment even names "the happy-path test above
(default 8443)" as the port it is avoiding) and the way `Serve.test.ts` does
(`testPort = 65535`, with a comment explaining precisely this hazard). Assert
the printed URL against that port instead of `:8443/`, and add the same
`afterEach(() => deleteServeRecord(port))` guard the Task 4 block has — this
test currently relies solely on the interrupt finalizer for cleanup.

`ui-lifecycle.feature`'s `@live` scenarios get this right already (ports
18443–18446, a fake `tailscale` on `$PATH`, and `$HOME` sandboxed to
`world.serveHomeDir`); only this one unit test escapes the sandbox.
