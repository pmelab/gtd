# Spec feedback — 01-serve-and-client-harness

Fresh pass over `64dd325f` → working tree, verified live. Last round's two items
are genuinely fixed: `react`, `react-dom`, `@tanstack/react-query`,
`@trpc/client` and `@trpc/react-query` now sit in `devDependencies` with only
`@trpc/server` in `dependencies` (T8's last criterion), pinned by a new
`tests/tooling/turbo.test.ts` case; `Router.ts`'s `runCommand` comment now says
the command runs VERBATIM instead of claiming vetting.

Verified myself this round, not by reading tests: `npm test` fully green;
deleted `src/web/generated.html` and `npm run build` regenerated it (1,068,851
bytes, React inlined) and produced one node bundle;
`gtd serve --host 127.0.0.1 --port 18443 --self-signed` started in a
**non-repository temp directory**, printed the `https://` URL on its own line
then a QR code, served HTTP 200 with **exactly one** `</script>`, and refused
plain http; the presented certificate carries
`IP Address:127.0.0.1, DNS:127.0.0.1` in its SAN,
`TLS Web Server Authentication`, `CA:FALSE` critical, and expires 2028-12-07 (<
825 days); `--bogus` exits 2, `--host` on `gtd next` exits 2;
`docs/configuration.md` documents `serve:` and all six sub-keys; neither changed
doc names a `src/` module.

One problem.

## 1. Every `serve:` config error prints two or three contradictory clauses

`gtd` with `.gtdrc` = `serve:\n  bogus: 1\n  port: 9443` prints:

```
gtd: Invalid gtd config: serve.bogus: is unexpected, expected: "roots" | "port" | "host" | "cert" | "key" | "loop"; serve: Expected undefined, actual {"port":9443,"bogus":1}
```

and a wrong-typed sub-key (`serve:\n  port: "nope"`) is worse — three clauses:

```
gtd: Invalid gtd config: serve.port: Expected number, actual "nope"; serve.port: Expected undefined, actual "nope"; serve: Expected undefined, actual {"port":"nope"}
```

The trailing `Expected undefined` clauses are artifacts of the `Schema.optional`
union branches, not facts about the user's file. They tell a reader that
`serve:` itself must be absent, which is false — the key is supported and
documented. Compare a nested `workflow:` error, which stays clean:

```
gtd: workflow config:
  - "entry.default" must name a machine
```

Cause: `src/Config.ts`'s `formatSchemaError` joins **every** issue
`ArrayFormatter.formatErrorSync` yields, including the `undefined` branch of
each `Schema.optional`. This never surfaced before this package because
`workflow`, `vars` and `modes` are all `Schema.optional(Schema.Unknown)` and
`Unknown` never fails. `serve:` is the first top-level key with a real nested
schema, so it is the first to expose the flaw — this package introduced the
user-visible regression and owns it.

Fix in `formatSchemaError`: drop issues whose message is the optional-branch
`Expected undefined, actual …` artifact when another issue exists at the same or
a deeper path, so the example above reduces to the one true clause
(`serve.bogus: is unexpected, expected: …` /
`serve.port: Expected number, actual "nope"`). Note `src/Config.test.ts:224`'s
assertion is a loose `/serve\.bogus/i` match, so it passes today with the noise
present and will still pass after the fix — tighten it to pin the whole message,
or the next regression is invisible again.
