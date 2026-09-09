# Tailscale hostname URL and certificate

## Requirement

`Server.ts#487` prints `https://${host}:${bound.port}/` and renders that same
string as the QR code, where `host` is whatever `resolveBindHost` produced. With
no `--host` and no `ui.host`, that is the raw CGNAT address
`pickBindHostFromSystem` scraped out of `os.networkInterfaces()` — a bare
`100.64.0.0/10` IP like `https://100.90.1.2:8443/`. It should detect Tailscale
and emit the Tailscale URL.

**This reverses a committed decision, so `Bind.ts`'s doc comment must be
rewritten as part of it, not left behind.** That comment reads: "Scanning for
this avoids shelling out to a `tailscale` binary, which is not installed on this
machine and not worth acquiring." The premise is false — `tailscale` is
installed at `/opt/homebrew/bin/tailscale` and `tailscale status --json`
answers.

`tailscale status --json` carries what the URL needs: `Self.DNSName` is
`philipps-macbook-pro-m5.tailb2e719.ts.net.` and `Self.CertDomains` is
`["philipps-macbook-pro-m5.tailb2e719.ts.net"]`. **`DNSName` ends in a trailing
dot — a fully-qualified DNS root — and must be stripped before it goes in a URL
or a QR code.** `CertDomains[0]` carries no trailing dot, which makes it the
safer source of the two.

Three ways detection comes back empty, each of which must fall back to today's
IP rather than fail: the binary is absent from `$PATH`; it is installed but
`BackendState` is not `"Running"`; or MagicDNS is off, so no `DNSName` is
reported at all. **An explicit `--host`/`ui.host` still wins over all of it** —
`resolveBindHost` already treats that as the user's own deliberate consent, and
detection must not override it.

Two structural constraints. First, `host` today is one string serving two jobs —
the socket bind address and the printed URL — and this splits them: bind stays
the CGNAT IP, display becomes the hostname. Second, `pickBindHostFromSystem`
exists specifically so that `program.test.ts`, `Server.test.ts`, and
`ui.steps.ts` can mock the real-system call without stubbing pure logic; a
Tailscale probe needs the same split — a pure parser over the JSON plus a thin
system entry point — or those three mock sites go stale. `CommandRunner` is
already in `resolveCertPair`'s requirements, so the subprocess itself needs no
new plumbing.

`Tls.ts`'s `SelfSignedCertRequest` already models exactly the split this
creates: `host` for the SAN's `DNS:` entry and an optional `ip` for its `IP:`
entry, so a hostname URL over an IP bind needs both filled in — a shape it
already supports, not a change.

**The concern extends to obtaining the real certificate, so it covers the
hostname URL and a `tailscale cert` branch together.** A hostname URL is the
only URL a real Tailscale-issued certificate can ever match, and a self-signed
cert for a CGNAT IP is a browser warning on every load; the two halves have no
separate acceptance.

`tailscale cert <domain>` is the command. **Its `--cert-file -` / `--key-file -`
stdout mode cannot be used for both at once — two PEM blocks would interleave on
one stream.** Write them to a temp dir instead, the same `mkdtempSync` shape
`generateSelfSignedCert` already uses in `Tls.ts`, then read both back as PEM
strings so the result is a plain `CertPair` and nothing downstream re-reads the
filesystem.

**`Self.CertDomains` being non-empty is the probe for whether this branch is
even available** — the field is populated only when the tailnet has HTTPS certs
enabled. Empty means `tailscale cert` would fail, and the branch must be skipped
rather than attempted.

**This makes `resolveCertPair`'s fourth branch, and it falsifies that function's
own doc comment.** The comment reads that neither `--self-signed` nor a
configured pair present "is a refusal, not a silent default to self-signed —
that would mean an unexpected `openssl` invocation on every plain `gtd ui`". A
plain `gtd ui` on an HTTPS-enabled tailnet now succeeds instead of refusing.
Rewrite the comment; the reasoning it records still holds for the `openssl`
path, which is exactly why the new branch shells out to `tailscale`, not
`openssl`.

Precedence, all four branches: `--self-signed` still wins outright, then a
configured `ui.cert`/`ui.key` pair, then the new `tailscale cert` path, then the
existing refusal. **The refusal's two hint lines must gain a third naming the
Tailscale path**, or a user on a tailnet with HTTPS disabled reads a message
that omits the reason they landed there.

`docs/cli.md` lines 81–83 and 149 describe the `--host` default and are PINNED
equal to the rendered help output — changing that default's wording means
regenerating that block, not hand-editing it.

## Design

**The binary is located through `$PATH` only** — one `tailscale status --json`
through `CommandRunner.bash`, no candidate-path list. **Risk accepted: a macOS
App Store install puts the binary at
`/Applications/Tailscale.app/Contents/MacOS/Tailscale` and never on `$PATH`, so
that user silently gets the CGNAT IP and the certificate refusal.**

**A non-zero `tailscale cert` fails the command outright — no fallback to the
refusal, no fallback to self-signed.** The error carries `tailscale cert`'s own
output as hint lines. The branch was chosen because `CertDomains` said it was
available, so a rate limit, an ACL change, or HTTPS switched off between the two
calls is a broken tailnet, and sliding back into "no certificate is configured"
would name the wrong cause. `--self-signed` remains the escape.

Certificate re-issue per invocation is accepted, not a problem to solve here:
`gtd ui` runs once per step, and `tailscale cert` returns its own cached
certificate when the existing one is still valid, so this is a local state-dir
read, not a CA round trip per step.

## Tasks

### Add the pure Tailscale status parser

Paths: `src/ui/Tailscale.ts` (new), `src/ui/Tailscale.test.ts` (new)

- [ ] `parseTailscaleStatus(json: string): TailscaleStatus | undefined` is pure
      — it takes the JSON text, never spawns anything
- [ ] It returns `undefined` on unparseable JSON
- [ ] It returns `undefined` when `BackendState !== "Running"`
- [ ] It returns `undefined` when `Self` is missing
- [ ] Otherwise it returns `{ hostname, certDomains: readonly string[] }`
- [ ] `hostname` is `CertDomains[0]` when present
- [ ] `hostname` falls back to `DNSName` **with its trailing dot stripped** — a
      test pins that `philipps-macbook-pro-m5.tailb2e719.ts.net.` yields
      `philipps-macbook-pro-m5.tailb2e719.ts.net`
- [ ] It returns `undefined` when MagicDNS is off, so neither `CertDomains` nor
      `DNSName` gives a name

### Probe the running system through `CommandRunner`

Paths: `src/ui/Tailscale.ts`

- [ ] The probe Effect shells out via `CommandRunner`, already in
      `resolveCertPair`'s requirements — no new port, no new `vi.mock` site, and
      `program.test.ts` / `Server.test.ts` / `ui.steps.ts` keep mocking only
      `BindSystem.js` as they do today
- [ ] It runs `tailscale status --json`, resolving the binary through `$PATH`
      only
- [ ] A spawn failure (binary absent) yields `undefined`, never a failed Effect
- [ ] A non-zero exit yields `undefined`, never a failed Effect
- [ ] **The probe never fails the command** under any of the three empty cases

### Split the bind host from the displayed host

Paths: `src/ui/Server.ts`, `src/ui/Server.test.ts`

- [ ] `Server.ts#369`'s single `host` becomes two values: `bindHost` and
      `displayHost`
- [ ] `bindHost` is unchanged — `resolveBindHost`'s CGNAT IP, passed to
      `httpsServer.listen`
- [ ] `displayHost` is the tailnet hostname when the probe answers, otherwise
      `bindHost`
- [ ] The printed URL and the QR code both use `displayHost`
- [ ] **An explicit `--host` or `ui.host` sets both and skips the probe
      entirely** — detection never overrides the user's deliberate consent

### Add the `tailscale cert` branch to `resolveCertPair`

Paths: `src/ui/Server.ts`, `src/ui/Tls.ts`, `src/ui/Tls.test.ts`

- [ ] Precedence is `--self-signed`, then a configured `ui.cert`/`ui.key` pair,
      then `tailscale cert`, then the refusal
- [ ] **Non-empty `Self.CertDomains` is the availability probe** — empty means
      the branch is skipped rather than attempted, and the refusal is reached
- [ ] `tailscale cert <domain>` writes to an
      `mkdtempSync(join(tmpdir(), "gtd-tls-"))` directory — **never
      `--cert-file -` / `--key-file -` for both at once, whose two PEM blocks
      would interleave on one stream**
- [ ] Both PEMs are read back as strings into a plain `CertPair`, so nothing
      downstream re-reads the filesystem
- [ ] **The temp directory is removed on every exit path via `Effect.ensuring` —
      a failed spawn, a non-zero exit, a read-back failure, and success alike**
      — it holds a private key
- [ ] A non-zero `tailscale cert` fails the command, carrying the command's own
      output as hint lines — no fallback to the refusal, no fallback to
      self-signed
- [ ] The refusal's two hint lines gain a third naming the Tailscale path
- [ ] The refusal is reachable only when `CertDomains` is empty, never after a
      failed `tailscale cert`
- [ ] `Tls.ts` needs no structural change: `SelfSignedCertRequest` already
      carries `host` for the SAN's `DNS:` entry and optional `ip` for its `IP:`
      entry

### Rewrite the two doc comments this falsifies

Paths: `src/ui/Bind.ts`, `src/ui/Server.ts`

- [ ] `Bind.ts`'s "avoids shelling out to a `tailscale` binary, which is not
      installed on this machine and not worth acquiring" is gone — the premise
      is false
- [ ] `resolveCertPair`'s comment no longer claims that no configured pair is
      always a refusal; a plain `gtd ui` on an HTTPS-enabled tailnet now
      succeeds
- [ ] That rewritten comment keeps the `openssl` reasoning it records, and says
      it is exactly why the new branch shells out to `tailscale`, not `openssl`

### Regenerate the pinned CLI docs

Paths: `docs/cli.md`

- [ ] `docs/cli.md` lines 81–83 and 149 match the rendered help output
      **regenerated from the help text, never hand-edited** — they are PINNED
- [ ] The `--host` default's wording reflects the new behaviour
- [ ] `npm test`'s docs pin check passes

### Cover both paths end to end

Paths: `tests/integration/features/ui.feature`

- [ ] A scenario with a fake `tailscale status --json` reporting
      `BackendState: "Running"` asserts the printed URL and the QR code carry
      the tailnet hostname
- [ ] A scenario with an empty probe asserts they carry the IP exactly as today
- [ ] Both are driven by a `CommandRunner` double, never a real `tailscale`
      binary
