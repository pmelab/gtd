# 01 — `gtd serve`, its config key, the HTTPS binding contract, and the client build harness

Two requirements land together because neither is worth anything alone: a server
with no client serves nothing, and a client with no server has nowhere to run.
Both center on `src/Cli.ts` and `package.json`.

The load-bearing constraint: `node:crypto`'s `X509Certificate` **parses**
certificates and cannot issue one, so `--self-signed` shells out to `openssl`.
Verified working on this machine's LibreSSL 3.3.6 with both a `serverAuth`
extended key usage and an IP subject-alternative name.

## Requirement — concern 1

### 1. `gtd serve`, its config key, and the HTTPS binding contract — TECHNICAL

A fourth top-level `.gtdrc` key, `serve:` (roots, port, host, certificate paths,
loop command template), with flags overriding and `schema.json` regenerated.
HTTPS is mandatory, not a flag: the Web Speech API is secure-context-only, so
plain http loses dictation silently. `--self-signed` generates a certificate
carrying the `serverAuth` extended key usage — iOS rejects one without it
outright. Binds to the Tailscale interface when present, otherwise refuses to
start unless `--host` is passed explicitly, because a server that reads and
writes working trees without authentication must never silently appear on the
LAN. Prints the URL and a QR code on start.

**Acceptance**: the exit-code table stays closed at five numbers — port in use,
missing certificate, and "no tailnet and no `--host`" all exit 1; a bad flag
exits 2. `docs/cli.md`'s `## Commands` block is a generated view under test, so
it lands in the same commit. See
[#219](https://github.com/pmelab/gtd/issues/219).

## Requirement — concern 8

### 8. The client, and how it is built and tested — TECHNICAL

React in TypeScript under `src/web/`, built by a second tsdown entry with
`platform: "browser"` and inlined into the single node bundle through the
`.html` text loader already configured; `gtd serve --dev` reads it off disk
instead. tRPC for client↔server, with refusals crossing as a typed error whose
payload carries `{stdout, stderr, exitCode}` intact. Server state in React
Query, drafts in `localStorage` keyed by worktree + file.

**Acceptance**: client code passes the same `typecheck`, `oxlint`, `oxfmt` and
`fallow` gates as the rest of `src/`. Storybook stories run as vitest tests
under a new `test:web` task, which needs all three of a `package.json` script, a
`turbo.json` task with explicit `inputs`, and its name in the `test` script's
task list. tRPC's server half becomes the first runtime dependency this package
carries purely for the web surface. See
[#218](https://github.com/pmelab/gtd/issues/218).

## Tasks

### T1 — the `serve:` config key

Fourth top-level member of the config schema, holding `roots`, `port`, `host`,
`cert`, `key` and `loop`. Follow the file's existing pattern — an optional
unknown value annotated with a hand-written JSON Schema constant beside the
others — so the schema generator needs no edit. The shape stays a literal: the
generator runs under jiti and must not reach the `.yaml` text loader.
Compilation joins the workflow, vars and modes compilers as a fourth entry; the
deep-merge walk-up already gives innermost-wins precedence.

Paths: `src/ConfigSchema.ts`, `src/ConfigSchema.test.ts`, `src/Config.ts`,
`src/Config.test.ts`, `src/PatternConfig.ts`, `scripts/generate-schema.ts`.

- [ ] `serve:` decodes with all six sub-keys absent, and with each one present
- [ ] an unknown sub-key under `serve:` is a decode failure at exit 2, because
      decoding uses excess-property rejection
- [ ] `schema.json` regenerates with a `serve` property and a non-empty
      description, and the generator itself is unchanged
- [ ] an innermost config level's serve port overrides an outer level's
- [ ] the schema module still imports nothing that pulls in a `.yaml` asset

### T2 — the `serve` command row and its flags

One command-table entry plus flag-table rows for `--host`, `--self-signed` and
`--dev`, each scoped to the `serve` kind. `--port` already exists for
`visualize`; widen its scope to both. Flags override config. The requirement
class for `serve` is config-and-filesystem: it must **not** require the invoking
directory to be a repository with a commit, because the roots it scans are
elsewhere.

Paths: `src/Cli.ts`, `src/Cli.test.ts`, `src/program.ts`, `src/program.test.ts`.

- [ ] `gtd serve --host h --port 8443 --self-signed --dev` parses to one command
      value with all four set
- [ ] `--host` on any other command is a scope violation at exit 2
- [ ] `--port` is accepted by both `serve` and `visualize`
- [ ] `gtd serve` in a directory that is not a repository still starts
- [ ] `gtd serve --bogus` exits 2

### T3 — self-signed certificate issuance

Spawn `openssl req -x509 -newkey rsa:2048 -nodes` with `-days 825` — the longest
iOS accepts — and three `-addext` arguments: a subject-alternative name carrying
the bind IP **and** the hostname, a `serverAuth` extended key usage, and a
critical non-CA basic constraint. The SAN must carry the IP, not only a common
name: iOS ignores the common name entirely.

Paths: `src/serve/Tls.ts`, `src/serve/Tls.test.ts`.

- [ ] a generated certificate's parsed extensions contain TLS web server
      authentication
- [ ] a generated certificate's SAN contains the bind IP as an IP entry, not
      only as a DNS entry
- [ ] validity is 825 days or fewer
- [ ] an absent `openssl` is a runtime refusal at exit 1 naming the binary
- [ ] a certificate and key pair given in config is used as-is and no `openssl`
      runs
- [ ] a configured certificate path that is missing or unreadable refuses at
      exit 1

### T4 — binding, refusal, and the printed URL

Detect the tailnet by scanning network interfaces for an IPv4 inside
`100.64.0.0/10`. Never shell out to a `tailscale` binary — it is not installed
on this machine and is not a dependency worth acquiring. No tailnet address and
no explicit `--host` refuses to start, because a server that reads and writes
working trees without authentication must never silently appear on the LAN.

Paths: `src/serve/Bind.ts`, `src/serve/Bind.test.ts`, `src/serve/Qr.ts`,
`src/serve/Qr.test.ts`, `src/serve/Server.ts`.

- [ ] an interface with an IPv4 in `100.64.0.0/10` is chosen as the bind host
- [ ] several such interfaces resolve deterministically, not by enumeration
      order
- [ ] no such interface and no `--host` refuses at exit 1 with a message naming
      both remedies
- [ ] no such interface with `--host` given binds to that host
- [ ] a port already in use refuses at exit 1
- [ ] start prints the `https://` URL on its own line, then a QR code encoding
      that exact URL
- [ ] the server is HTTPS unconditionally — no flag yields plain http, because
      the speech API is secure-context-only and would lose dictation silently

### T5 — the two-stage build and `--dev`

The build config becomes an array of two configs, ordered browser-first. The
browser config bundles the client entry for the browser platform; a small step
inlines its output into a generated HTML file as one module script; the node
config imports that file through the `.html` text loader already configured —
the same mechanism the workflow visualizer's 79 KB hand-written HTML already
uses. The generated file is gitignored beside `schema.json` so the format check
never sees it. `--dev` reads the client off disk instead.

Paths: `tsdown.config.ts`, `src/web/main.tsx`, `src/web/index.html`,
`.gitignore`, `src/serve/Server.ts`.

- [ ] `npm run build` produces one node bundle with the client inlined, and the
      browser config runs first
- [ ] a fresh clone builds with no committed generated HTML present
- [ ] the generated HTML is gitignored and `format:check` passes without it
- [ ] `gtd serve` without `--dev` serves the inlined client and reads no file
      from the source tree
- [ ] `gtd serve --dev` reflects an edit to a client source file with no rebuild

### T6 — the gates the client must pass

The root tsconfig already sets JSX and includes the source directory, so `.tsx`
typechecks with no change. But its `lib` is `["ESNext"]` with **no `DOM`**, and
widening that globally would let node-side code reach `document` and `fetch`
unchallenged — so a second tsconfig scoped to the client directory adds `DOM`
and `DOM.Iterable`, and the typecheck task runs both invocations. The lint
config gains the `react` plugin. The dead-code config gains the client entry, or
the entire client reads as dead. The mutation config's mutate array doubles as
the coverage include list, so client files stay out of it — mutation-testing
React components buys nothing.

Paths: `src/web/tsconfig.json`, `tsconfig.json`, `.oxlintrc.json`,
`.fallowrc.json`, `stryker.config.json`, `package.json`.

- [ ] a client file using `document` typechecks
- [ ] a node-side file using `document` fails typecheck
- [ ] `typecheck` runs both tsconfigs and fails if either fails
- [ ] a React hooks-rule violation in a client file fails `lint`
- [ ] `deadcode` reports zero dead files with the client present
- [ ] `format:check` covers every client file
- [ ] no client file appears in the mutation config's mutate array

### T7 — Storybook, browser mode, and the `test:web` task

`@storybook/react-vite` plus the vitest addon and vitest browser mode, with a
`.storybook/` directory holding the config. Vitest already brings vite, so no
second bundler enters the repository. Browser mode becomes a **fourth** vitest
project beside the unit project and the two end-to-end ones. CI grows an
explicit chromium install step — a browser that downloads implicitly on first
run is a failure waiting for a cache miss.

**This costs roughly 300 MB of devDependencies and a Playwright chromium
download in CI.** Bought deliberately: a catalog browsable on a real phone is
how both prototypes were validated, and every screen here is a phone screen
before it is a component.

A new check needs **all three** or the tooling test that pins them fails: a
`package.json` script, a task with an explicit `inputs` array, and the task name
in the `test` script's task list.

Paths: `package.json`, `turbo.json`, `vitest.config.ts`, `.storybook/main.ts`,
`.storybook/preview.ts`, `.fallowrc.json`, `.github/workflows/`,
`tests/tooling/turbo.test.ts`.

- [ ] `npm run test:web` runs stories as tests and fails on a failing story
- [ ] `test:web` has all three of a `package.json` script, a task with an
      explicit `inputs` array, and its name in the `test` script's list
- [ ] that `inputs` array covers both the client directory and `.storybook/`
- [ ] `test:web` is cached: a second run with no input change is skipped
- [ ] the Storybook dev server serves a catalog reachable from a phone on the
      same network
- [ ] CI installs chromium explicitly, and a run with a cold cache still passes
- [ ] `.storybook/` config files are covered by `format:check` and `lint`, and
      carry dead-code entries so they are not reported as dead

### T8 — the tRPC transport and its refusal payload

tRPC for client-to-server calls. A refusal crosses as a typed error whose
payload carries standard output, standard error and the exit code **intact and
separately readable** — never flattened into one string, because every gtd
refusal exits 1 and the text is the only discriminator. Server state goes in
React Query. The Effect-to-Promise boundary sits at the resolver and nowhere
else: this repository is Effect end to end, and one boundary is the whole point.

**tRPC's server half becomes the first runtime dependency this package carries
purely for the web surface.**

Paths: `src/serve/Router.ts`, `src/serve/Server.ts`, `src/web/api.ts`,
`package.json`.

- [ ] a resolver's refusal reaches the client as a typed error with all three
      payload fields separately readable
- [ ] a two-line standard error arrives with both lines intact
- [ ] the client's call types are inferred from the router with no hand-written
      duplicate
- [ ] exactly one Effect-to-Promise boundary exists per resolver
- [ ] the new runtime dependency is declared under `dependencies`, not
      `devDependencies`

### T9 — the documentation views under test

The command help is generated from the flag and command tables, and a test pins
the CLI reference's `## Commands` fence equal to that rendered help
byte-for-byte. Another test pins its exit-code table against the recognized code
set. Both land in this same commit or the suite reds.

Paths: `docs/cli.md`, `docs/configuration.md`, `src/Cli.test.ts`,
`src/ExitCodes.test.ts`.

- [ ] the `## Commands` fence equals the rendered help exactly, including the
      new `serve` row and every new flag
- [ ] the exit-code table still holds exactly `0`, `1`, `2`, `130` and `143`
- [ ] port in use, a missing certificate, an absent `openssl`, and "no tailnet
      and no `--host`" are all exit 1; a bad flag is exit 2
- [ ] the configuration reference documents `serve:` and each of its six
      sub-keys
- [ ] no documentation file added or edited here names a module under `src/`
