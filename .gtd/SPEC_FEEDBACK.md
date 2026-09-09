# 02 — Tailscale hostname URL and certificate

Most of the package is met: `src/ui/Tailscale.ts`'s pure parser and
never-failing probe, the bind/display split in `Server.ts`, the fourth
`resolveCertPair` branch with `Effect.ensuring` tmpdir cleanup in `Tls.ts`, both
rewritten doc comments, the third refusal hint, and the two e2e scenarios all
exist and pass (`npm run test:unit`, `format:check`, `lint`, `deadcode`,
`e2e-live ui.feature` all green here).

Two things are wrong.

## `--self-signed` issues a certificate that does not match the printed URL

`Server.ts#resolveHostsAndCert` runs the probe whenever no explicit
`--host`/`ui.host` was given — including with `--self-signed`. So `displayHost`
becomes the tailnet hostname while
`resolveCertPair(options, config, bindHost, …)` still receives only `bindHost`,
and the self-signed branch builds `{ host: bindHost, ip: bindHost }`. The SAN is
`IP:100.90.1.2,DNS:100.90.1.2`; the URL and QR code say
`https://host.tailnet.ts.net:8443/`. Name mismatch on every load — strictly
worse than before this package, where URL and SAN both carried the IP.

This is the exact case the requirement text calls out: "`SelfSignedCertRequest`
already models exactly the split this creates: `host` for the SAN's `DNS:` entry
and an optional `ip` for its `IP:` entry, so **a hostname URL over an IP bind
needs both filled in** — a shape it already supports, not a change." Nothing
fills both in.

It is reachable in normal use: any tailnet with MagicDNS on and HTTPS certs off
(`CertDomains` empty) plus `gtd ui --self-signed` — and it is the shape both new
`ui.feature` scenarios spawn, which is why neither catches it.

A fix turn must pass the display host into `resolveCertPair` and, on the
self-signed branch, emit
`{ host: displayHost, ip: isIP(bindHost) ? bindHost : undefined }` so the SAN
carries `DNS:<tailnet hostname>` alongside `IP:<CGNAT>`. Keep the existing guard
that an explicit non-literal hostname `--host` yields no `ip` — openssl rejects
a non-literal `IP:`. Add a unit test pinning the SAN for "probe answered,
`--self-signed`, no `--host`".

## `docs/cli.md`'s `ui` command description still states the old default

The flags-table entry (line ~149) was regenerated from `Cli.ts#FLAGS` and reads
correctly. Lines 81–83, inside the same PINNED `## Commands` block, were not
touched and still read:

```
                   like every other state command. --host <addr> and
                   --port <n> override the bound address (default: an address
                   picked automatically, and port 8443); --self-signed
```

The pin check passes only because the `ui` command's help text in `Cli.ts` is
equally unchanged. The task requires "the `--host` default's wording reflects
the new behaviour" for lines 81–83 as well as 149 — the printed URL now uses the
detected Tailscale hostname, and this description does not say so. Edit the help
text in `Cli.ts`, then regenerate the doc block; never hand-edit `docs/cli.md`.

## Note, not a blocker

Both new `@live` scenarios spawn `gtd ui` with no `--host`, so
`resolveBindHost`'s real `os.networkInterfaces()` scan must find a genuine CGNAT
interface or the run fails on the "never printed its bound URL" assert after 5s.
`ui.feature`'s own preceding comment states that coverage depending on "the
CI/dev machine's real network shape" was deliberately not added. It passes on
this machine; it will fail on any runner not joined to a tailnet. If that is
accepted, say so in the scenario comment rather than leaving it implicit.
