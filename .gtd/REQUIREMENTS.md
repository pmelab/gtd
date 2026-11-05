# gtd ui: plain-HTTP mode behind a trusted local proxy

Closes pmelab/gtd#567. **`gtd ui --http` serves plain HTTP, only on a loopback
bind**, so a local reverse proxy (pitchfork,
`https://gate.<wt>.<proj>.internal`) terminates TLS with its own trusted CA.
**HTTPS stays mandatory on every other path.**

## Concerns

1. **PRODUCT — the `--http` flag.** New `gtd ui`-only flag, no value. Rejected
   on every other command with the usual "only valid for `gtd ui`" scope error.
   Shown in `gtd ui --help` and the pinned `docs/cli.md` block.
2. **PRODUCT — loopback only.** The resolved bind host (from `--host` or
   `ui.host`) must be a loopback address: any `127.0.0.0/8` literal, `::1`, or
   `localhost`. Anything else (`0.0.0.0`, `::`, a CGNAT/LAN address, a hostname)
   is a usage error (exit 2) before anything binds. With no `--host` and no
   `ui.host`, `--http` binds `127.0.0.1` and skips the `tailscale serve` walk
   and the Tailscale interface scan entirely.
3. **PRODUCT — no certificate in HTTP mode.** `--http` never runs `openssl` or
   `tailscale cert` and never reads `ui.cert`/`ui.key`, even when both are
   configured. `--http` plus `--self-signed` is a usage error.
4. **PRODUCT — printed URL.** HTTP mode prints `http://<host>:<port>/` — the
   local address actually bound. The proxy owns the public URL; gtd does not
   learn it.
5. **TECHNICAL — proxy correctness.** Nothing to build: gtd ui sets no cookies,
   runs no origin/CSRF check, builds request URLs from a fixed origin, and the
   client calls `/trpc` relative to whatever origin served it. So
   `X-Forwarded-Proto` is never read, in any mode. Pin it with a scenario: a
   request with a proxy `Host` and `X-Forwarded-Proto: https` is served normally
   in HTTP mode.
6. **TECHNICAL — docs.** `docs/cli.md` (generated view, pinned to help) and
   `docs/configuration.md`'s `ui` section (`--http` joins the flag list that
   overrides `ui`; note `cert`/`key` are ignored under `--http`).
7. **Follow-up outside this repo.** Workbench `_bench/gate.sh` and
   `_bench/lib.sh` switch to `gtd ui --http --host 127.0.0.1 --port <n>` and
   drop `proxy_tls = "passthrough"` once this ships. Not part of this build.

## Acceptance Criteria

- AC-1: `gtd ui --http --host 127.0.0.1 --port N` serves the client HTML and the
  `/trpc` API over plain HTTP on port N, and a hand-off through it ends the
  process with exit 0, as over HTTPS.
- AC-2: In `--http` mode `gtd ui` prints `http://<host>:<port>/` with the bound
  host and port.
- AC-3: In `--http` mode no certificate is generated or loaded: no `openssl` or
  `tailscale cert` runs, and configured `ui.cert`/`ui.key` paths are never read
  — a missing file at those paths does not stop startup.
- AC-4: `--http` with a non-loopback bind host — `0.0.0.0`, `::`, `100.64.0.5`,
  `192.168.1.10`, or a non-`localhost` hostname, whether from `--host` or
  `ui.host` — fails with a usage error (exit 2) naming the loopback requirement,
  and nothing listens.
- AC-5: `--http` accepts any `127.0.0.0/8` literal, `::1`, and `localhost` as
  the bind host.
- AC-6: `gtd ui --http` with no `--host` and no `ui.host` binds `127.0.0.1` (on
  `--port`/`ui.port` when given, otherwise any free port), prints
  `http://127.0.0.1:<port>/`, and attempts no `tailscale serve` publish.
- AC-7: `--http` combined with `--self-signed` fails with a usage error (exit
  2).
- AC-9: `gtd ui --help` lists `--http` with a one-line description saying it
  serves plain HTTP for a local TLS-terminating proxy and needs a loopback
  `--host`.
- AC-10: In `--http` mode a request carrying a proxy `Host` header
  (`gate.wt.proj.internal`) and `X-Forwarded-Proto: https` gets the client HTML
  and working `/trpc` responses.

## Impact

- `src/cli` unit: new `--http` entry in the flag table (`Cli.ts`), scoped to
  `ui`; `UiCommandOptions` gains an `http` field passed through `Program.ts`.
- `src/ui` unit: `Server.ts` — `resolveListener` gets a third direct-bind branch
  (plain listener, no `tls`), skipping `resolveCertPair` and the serve walk;
  loopback check on the resolved host, raised as `UiUsageError` before `listen`.
  `UiListener` already takes an optional `tls`, so no new port.
- Public surface: new CLI flag `gtd ui --http` — additive, a `feat`, not
  breaking under `COMPATIBILITY.md`. No new config key, no driver-protocol
  change.
- `docs/cli.md`: `### gtd ui` block is pinned to rendered help — regenerate,
  never hand-edit.
- `docs/configuration.md`: `ui` section's "Flags … always override" line and the
  `cert`/`key` entry.
- `tests/integration/features/ui.feature` / `ui-lifecycle.feature`: new `@inmem`
  scenarios using the in-memory `UiListener`/`UiShell` twins.
- Surprise: the sketch's "Secure cookie / origin check / X-Forwarded-Proto"
  bullet targets code that does not exist — gtd ui has no cookies and no origin
  checks, so trusting the header is a no-op.
- Surprise: `localhost` as `--host` already skips the `IP:` SAN for
  `--self-signed`; HTTP mode needs no SAN logic at all.
- Out of repo: workbench gate daemon (`_bench/gate.sh`, `_bench/lib.sh`,
  workbench `README.md`) adopts `--http` later.

## Already In Place

- Plain-HTTP listener: `UiListener.Live` in `src/ui/Server.ts` already picks
  `http.createServer` when `tls` is absent (used today for the `tailscale serve`
  loopback target). HTTP mode must reuse it, not add a second listener.
- Fixed request origin: `viaNode` in `src/ui/Server.ts` builds every request URL
  against `http://localhost`, never the client `Host` header. Must keep working
  unchanged — it is why a proxy `Host` is harmless.
- Relative API URL: `src/web/api.ts` and `src/web/main.tsx` call `/trpc`
  relative to the serving origin, so the browser stays on the proxy's HTTPS
  origin (secure context, no mixed content). Must stay relative.
- No cookies, no origin/CSRF checks anywhere in `src/ui` or `src/web`; no code
  reads `X-Forwarded-*`. HTTP mode adds none.
- Explicit host skips serve: `resolveListener` in `src/ui/Server.ts` goes
  straight to a direct bind whenever `--host`/`ui.host` is set or
  `--self-signed` is passed; HTTP mode must sit on that same no-serve path.
- HTTPS-mandatory refusal: `resolveCertPair` in `src/ui/Server.ts` refuses
  ("HTTPS is mandatory and no certificate is configured") when no cert source
  exists. Must keep firing for every non-`--http` direct bind.
- Usage-error exit: `UiUsageError` (`src/ui/Ports.ts`) maps to the CLI usage
  exit code 2. The loopback and flag-combination refusals must use it.
- Flag scope errors: the flag table in `src/cli/Cli.ts` rejects a `ui`-scoped
  flag on other commands with "only valid for `gtd ui`". `--http` must be
  declared through it, so it fails as a usage error on every non-`ui` command.
- Pinned help docs: `docs/cli.md`'s command blocks are tested equal to rendered
  help; adding the flag must regenerate that block.
- Startup refusal ordering: `runUiCommand` refuses an unrenderable rest before
  resolving host or certificate. HTTP mode keeps that order.

## Answered Questions

### What is the flag called?

`--http` — the sketch's own acceptance bullets use it, and it names what
changes.

### Does `--http` get a matching `ui.http` config key?

No — the only consumer passes flags per daemon; a config key can follow if
asked.

### Which addresses count as loopback?

Any `127.0.0.0/8` literal, `::1`, and `localhost` — all resolve only to the
local machine.

### What happens to `ui.cert`/`ui.key` under `--http`?

Ignored, no error — the flag is the explicit, per-invocation choice and
overrides config like every other `ui` flag.

### Does `--http` combine with `--self-signed`?

No — usage error; asking for both TLS and no TLS is a mistake to surface, not
resolve.

### Should HTTP mode require `X-Forwarded-Proto: https` on requests?

No — the loopback bind is the trust boundary, and no code depends on the scheme,
so enforcing the header buys nothing.

### What URL does HTTP mode print?

The bound `http://<host>:<port>/` — gtd cannot know the proxy's public URL, and
the workbench already knows its gate URL.

### What does `--http` do when no host is given at all?

Defaults the bind to `127.0.0.1` — the human picked it, so
`gtd ui --http --port N` works without `--host`.
