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
