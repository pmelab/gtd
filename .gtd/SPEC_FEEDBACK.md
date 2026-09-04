# Spec feedback — 01-serve-and-client-harness

Fresh pass over `64dd325f` → working tree, verified live (not by reading tests):
rebuilt from a deleted `src/web/generated.html`, loaded the served page in
headless chromium (`#root` renders `<div id="gtd-app">gtd</div>`, zero page
errors, exactly one `</script>`), confirmed `--dev` reflects an edit to
`src/web/App.tsx` with no `npm run build`, drove a refusal across tRPC
(`{"stdout":"out1\n","stderr":"e1\ne2\n","exitCode":3}` — three fields
separately readable, both stderr lines intact), and exercised every exit code
the spec names (no tailnet → 1, port in use → 1, missing cert → 1, `--bogus` →
2, `--host` on `gtd next` → 2). Both of last round's items are genuinely fixed:
`inlineScript` uses a replacement FUNCTION plus a `</script>` escape, and a
hostname `--host` now lands in the SAN's `DNS:` slot
(`serve --host localhost --self-signed` starts). `npm test` is green, `test:web`
fails on a deliberately broken story (exit 1) and is cached on a second run,
both tsconfigs run, a node-side `document` still fails typecheck, a hooks
violation still reds `oxlint`, `deadcode` reports 0%.

One deviation remains, plus one false comment.

## 1. Five browser-only packages are in `dependencies`, not `devDependencies`

Requirement 8 states: "**tRPC's server half** becomes the **first** runtime
dependency this package carries purely for the web surface" — singular, and
specifically the server half. `package.json` instead added six new runtime deps
for the web surface: `@trpc/server` (correct, T8's last criterion), plus
`react`, `react-dom`, `@tanstack/react-query`, `@trpc/client` and
`@trpc/react-query`.

None of those five is resolved at runtime. `tsdown.config.ts`'s `web` config
carries `deps: { alwaysBundle: [/.*/] }`, so they are inlined into
`dist/web/main.js` → `src/web/generated.html` → the node bundle at BUILD time.
Measured on the built artifact: the only bare-specifier import left in
`dist/gtd.bundle.mjs` is `qrcode-terminal`, the one package deliberately kept
external.

Cost: every `npm i -g @pmelab/gtd` installs React, React DOM, React Query and
both tRPC client packages for nothing.

Move those five to `devDependencies` and keep `@trpc/server` in `dependencies`
(T8 pins it there). `--dev` is unaffected — it already requires a gtd source
checkout with devDependencies installed to run `npx tsdown --filter web` at all.

## 2. `Router.ts`'s "vetted shell command" comment describes vetting that does not exist

`src/serve/Router.ts`'s `runCommand` JSDoc reads "Runs a **vetted** shell
command via `CommandRunner`". Nothing vets it: `commandInput` only checks
`typeof value.command === "string"`, and the resolver passes it straight to
`runner.bash`. Confirmed live — `POST /trpc/runCommand` with
`{"command":"printf \"out1\\n\"; ... exit 3"}` ran verbatim, so the endpoint is
arbitrary shell execution on the bind address.

The unauthenticated surface itself is the spec's accepted design (tailnet-only
binding, refuse otherwise). The comment is not: per `AGENTS.md`, a comment
carries a non-obvious invariant, and this one asserts a guard that isn't there —
the next reader adds a caller trusting it. Either drop the word "vetted" and say
plainly that any string runs, or add the vetting.
