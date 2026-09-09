# Review: 3e6c89d

<!-- base: d944a596643e30c2d8695a4e7d99ed8012c484b7 -->

`gtd ui` now prints a **tailnet hostname** instead of a raw CGNAT IP, and can
fetch a **real Tailscale-issued certificate** for it. Plus a dark page shell.

## Tailscale detection (new module)

A pure parser plus a best-effort subprocess probe. Every empty case — binary
absent, spawn failure, non-zero exit, backend not `Running`, MagicDNS off —
resolves to `undefined`, never a failed Effect.

- [ ] ./src/ui/Tailscale.ts#27 — `parseTailscaleStatus`, pure, unit-tested
      directly Prefers `CertDomains[0]`, falls back to `DNSName` with the
      trailing dot stripped. Empty string is treated as absent.
- [ ] ./src/ui/Tailscale.ts#56 — `probeTailscaleStatus` shells
      `tailscale status --json` through the existing `CommandRunner` port
      **Risk: no timeout.** A hung or slow `tailscale` binary blocks `gtd ui`
      startup indefinitely, on every plain invocation with no `--host`. Nothing
      bounds this call.
- [ ] ./src/ui/Bind.ts#4 — doc comment corrected: the CGNAT scan is the BIND
      address only Replaces the stale "not worth acquiring a tailscale binary"
      note, which this change contradicts.
- [ ] ./src/ui/Tailscale.test.ts#9 — parser + probe coverage, all five fallback
      paths

## Real Tailscale certificate

New fourth branch in cert resolution: `--self-signed` → configured pair →
`tailscale cert` → refusal. A tailnet hostname URL can only be matched by a
Tailscale-issued cert; a self-signed cert for a CGNAT IP warns on every load.

- [ ] ./src/ui/Tls.ts#107 — `obtainTailscaleCert` writes both PEMs to a
      `mkdtempSync` dir and reads them back Two files because
      `--cert-file -`/`--key-file -` would interleave on one stdout stream. The
      dir holds a private key and is removed on every exit path via
      `Effect.ensuring`.
- [ ] ./src/ui/Server.ts#136 — the branch fires only when `certDomains` is
      non-empty A non-zero `tailscale cert` exit **fails outright** — no
      fallback to refusal, no fallback to self-signed. Deliberate: `CertDomains`
      already said it was available, so failure means a broken tailnet.
      `--self-signed` is the escape.
- [ ] ./src/ui/Server.ts#146 — refusal message gains a third remedy naming the
      tailnet
- [ ] ./src/ui/Tls.test.ts#158 — success, tmpdir cleanup after non-zero exit,
      tmpdir cleanup after unreadable output, spawn failure **Flake risk: two
      tests scan the shared OS tmpdir for `gtd-tls-*` dirs** (lines 135 and
      206). `generateSelfSignedCert` creates dirs with the same prefix in the
      same place — a concurrently running vitest file reds these. The
      `gtdTlsDirs` helper is also duplicated verbatim at #131 and #202.

## Bind host vs display host

The bound address and the printed address are now two values. The probe only
runs when neither `--host` nor `ui.host` was given — explicit consent is never
overridden.

- [ ] ./src/ui/Server.ts#376 — `resolveHostsAndCert` extracted to keep
      `runUiCommand` complexity flat
- [ ] ./src/ui/Server.ts#108 — the self-signed SAN splits: `displayHost` as
      `DNS:`, `bindHost` as `IP:` only when literal Fixes a real mismatch: a
      detected hostname URL over an IP bind previously got a SAN of
      `IP:<ip>,DNS:<ip>` while the browser dialed the hostname.
- [ ] ./src/ui/Server.ts#539 — `listen` takes `bindHost`; the printed URL and QR
      code take `displayHost`
- [ ] ./src/ui/Server.test.ts#557 — probe answers: URL and QR both carry the
      hostname, bind stays on the CGNAT IP
- [ ] ./src/ui/Server.test.ts#606 — probe empty: identical output to before the
      change
- [ ] ./src/ui/Server.test.ts#647 — explicit `--host`: `CommandRunner` is never
      invoked
- [ ] ./src/ui/Server.test.ts#21 — `pickBindHostFromSystem` mock upgraded to
      `vi.fn` so tests can override it Uses `mockReturnValueOnce`; an unconsumed
      queued value would leak into a later test. Check there is a
      `resetAllMocks`/`restoreMocks` in effect.
- [ ] ./tests/integration/features/ui.feature#261 — comment explaining why this
      coverage sits at the unit tier, not `@live` A spawned subprocess can
      inject neither `pickBindHostFromSystem` nor `CommandRunner`, and would
      need the runner's machine on a real tailnet.

## Help text

The `## Commands` block and flag table in `docs/cli.md` are pinned equal to
rendered help — both sides move together.

- [ ] ./src/Cli.ts#203 — `--host` help: now also names the printed URL and the
      Tailscale default
- [ ] ./src/Cli.ts#496 — `gtd ui` command help split into per-flag clauses
- [ ] ./docs/cli.md#81 — the pinned rendering of both

## Dark page shell

Components hardcode dark-surface colors; without a body background the page
rendered as dark chips on white.

- [ ] ./src/web/index.html#18 — `color-scheme: dark`, body background `#111`,
      text `#eee`, system font stack
- [ ] ./src/ui/Server.test.ts#477 — asserts the shell survives into both the
      packaged bundle and the `--dev` template The production assertion runs
      with an exploding filesystem and runner, so it proves the bundle is
      self-contained.
