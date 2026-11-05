# Quality

## `--http --host ::1` prints an invalid URL, and the test pins it

`httpBind` (`src/ui/Server.ts`) builds the printed URL as
`http://${bindHost}:${bound.port}/` without bracketing an IPv6 literal. For
`--host ::1` — one of the three loopback forms the change explicitly accepts and
advertises in the refusal hint ("use 127.0.0.0/8, ::1 or localhost") — the URL
printed is `http://::1:4443/`, which no browser or proxy config parses as host
`::1` port `4443`; it must be `http://[::1]:4443/`.

The new `it.each(["127.0.0.2", "::1", "localhost"])` case in
`src/ui/Server.test.ts` asserts `written[0]` equals
`` `http://${host}:4443/\n` `` for `::1` too, so it locks the malformed URL in
rather than guarding against it.

Fix: bracket when `isIP(bindHost) === 6`, and make the `::1` expectation
`http://[::1]:4443/`.

Minor, same predicate: `isLoopbackHost` matches only the literal `::1`, so
equivalent spellings (`0:0:0:0:0:0:0:1`, `::ffff:127.0.0.1`) are refused as
non-loopback — fail-safe, but worth normalising if IPv6 is meant to be supported
at all.

## `--http` + `--self-signed` conflict is checked twice

`parseArgv` (`src/cli/Cli.ts`) rejects `--http` with `--self-signed` as a usage
error, and `httpBind` (`src/ui/Server.ts`) repeats the same check with a second
message. `selfSigned` reaches `runUiCommand` only from that flag (the only
caller is `Program.ts`), so the `httpBind` branch is unreachable from the CLI;
it exists only for its own unit test. Two messages for one rule also drift
apart.

Fix: keep one check (the parse-time one) and delete the `httpBind` branch and
its `--http with --self-signed is a usage error` test, about 10 lines.

## No `@inmem` cucumber scenario for `gtd ui --http`

`AGENTS.md` requires a cucumber scenario tagged `@inmem` for each new feature.
The change touches no file under `tests/`; `--http` is exercised only by unit
tests in `src/ui/Server.test.ts`. Sibling `--self-signed` has scenarios in
`tests/integration/features/ui.feature`. The wiring from argv through
`parseArgv` and `Program.ts` to `runUiCommand` is covered only by the
`Cli.test.ts` flag-name list. That list checks the flag exists, not that it
reaches the server. Dropping `http` in `Program.ts` or `ToolCommands.ts` would
pass every new test.

Fix: add a scenario in `ui.feature` that runs `gtd ui --http` and asserts a
plain `http://127.0.0.1:<port>/` URL, plus one refusing `--host 0.0.0.0`.

## `--http` without `--host` contradicts the documented `--port`/`ui.host` contract

The spec decision in AC-6 ("`--http` with no `--host` and no `ui.host` binds
`127.0.0.1`, on `--port`/`ui.port` when given") conflicts with the user-facing
contract that is still in place, and that the change did not update:

- `--port` help (`docs/cli.md`, pinned to rendered help): "The tailscale serve
  port … or with --host the port to bind". Under `--http` with no `--host`,
  `--port` is a bind port, which this text says it is not.
- `docs/configuration.md` `ui.port`: "with neither this key nor `host` given,
  the port `gtd ui` publishes through `tailscale serve`".
- `docs/configuration.md` `ui.host`: "With neither this key nor `--host` given,
  `gtd ui` publishes through `tailscale serve` … it never refuses". `--http`
  with no host skips serve, and refuses a non-loopback `ui.host`.
- The new `--http` help line itself says "needs a loopback --host", but AC-6
  makes `--host` optional.

A reader following the docs believes `gtd ui --http --port 4443` publishes to
tailscale serve on 4443, or that `--host` is required. The code binds
`127.0.0.1:4443`.

Fix: reword the `--http` help ("binds 127.0.0.1 unless a loopback --host is
given"), add "or `--http`" to the `--port` help and to the `ui.port`/`ui.host`
entries as a second way to opt out of serve, then regenerate the pinned
`docs/cli.md` block.
