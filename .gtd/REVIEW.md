# Review: d98b843

<!-- base: e49e45dad6cb75b11620a7ab115cd89c89d11717 -->

**`gtd ui --http` adds a plain-HTTP, loopback-only listener for a local
TLS-terminating proxy.** It skips `tailscale serve`, ignores `ui.cert`/`ui.key`,
and refuses any non-loopback host.

## Scenarios

- [ ] ./tests/integration/features/ui.feature#547-562 —
      `gtd ui --http --host 0.0.0.0` exits 2 with a stderr message naming
      "loopback"; a wildcard bind under plain HTTP is a usage error, not a
      listener.

## Plain-HTTP bind path

`--http` short-circuits the listener resolution before the serve walk and the
direct TLS bind. Bind host defaults to `127.0.0.1`; an explicit host (flag or
`ui.host`) must be loopback.

- [ ] ./src/ui/Server.ts#620-646 — `isLoopbackHost` accepts `localhost`, any
      `127.x` IPv4, and any IPv6 form normalizing to `::1`; `httpBind` fails
      with `UiUsageError` before `listen`, else binds with no `tls` and prints
      an `http://` URL, bracketing IPv6. **`::ffff:127.0.0.1` (IPv4-mapped
      loopback) is refused** — conservative, acceptable. `httpBind`'s `options`
      parameter is unused; drop it.
- [ ] ./src/ui/Server.ts#690-693 — `--http` branch runs first, so it wins over
      `--host`/`ui.host` serve opt-out and needs no teardown (serve never
      touched).
- [ ] ./src/ui/Server.ts#53-53 — `http` added to `UiCommandOptions`, optional so
      existing callers stay unchanged.

## CLI flag wiring

New `--http` flag, scoped to `gtd ui`, threaded through the command type into
`UiRequest`.

- [ ] ./src/cli/Cli.ts#187-187 — `--port` help now mentions `--http` as a
      bind-port mode.
- [ ] ./src/cli/Cli.ts#212-221 — flag row: arity 0, `ui`-only, help text pinned
      into `docs/cli.md`.
- [ ] ./src/cli/Cli.ts#1150-1150 — bag type gains `--http`.
- [ ] ./src/cli/Cli.ts#1199-1210 — `--http` with `--self-signed` is a usage
      error; otherwise `http: true` passes on. **No test covers the `--http` +
      `--self-signed` refusal** — a regression there goes unseen.
- [ ] ./src/cli/Program.ts#147-147 — `http?` on the `ui` command variant.
- [ ] ./src/cli/Program.ts#1264-1264 — forwards `http` into the UI request.
- [ ] ./src/cli/ToolCommands.ts#11-11 — `http?` on `UiRequest.options`.
- [ ] ./src/cli/Cli.test.ts#35-35 — registers `--http` in the flag-name list the
      CLI tests iterate.

## Unit tests

- [ ] ./src/ui/Server.test.ts#1635-1662 — default bind is `127.0.0.1` with
      `tls: undefined`, URL `http://127.0.0.1:4443/`, nonexistent cert paths
      ignored, no shell call.
- [ ] ./src/ui/Server.test.ts#1665-1691 — accepts `127.0.0.2`, `::1`,
      `0:0:0:0:0:0:0:1`, `localhost`; checks IPv6 URL bracketing.
- [ ] ./src/ui/Server.test.ts#1693-1719 — refuses `0.0.0.0`, `::`, `100.64.0.5`,
      `192.168.1.10`, `example.com` (via `ui.host` config) with `UiUsageError`
      and never calls `listen`.

## Docs

- [ ] ./docs/cli.md#611-621 — generated help view: `--port` wording and new
      `--http` row.
- [ ] ./docs/configuration.md#1081-1108 — `port`/`host`/`cert`/`key` describe
      `--http`'s effect. **"Flags … `--http` always override the matching `ui`
      value" is misleading: no `ui.http` key exists.** Wording only; leave it or
      reword.
