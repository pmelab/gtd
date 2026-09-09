# Requirements

## Read `CertDomains` from the top level of `tailscale status --json` (TECHNICAL)

**The Tailscale certificate branch is dead code — `CertDomains` is read off
`Self`, where it does not exist.**

In real `tailscale status --json` output `CertDomains` is a TOP-LEVEL field.
`Self` carries `DNSName` and no `CertDomains` key at all. Confirmed against
tailscale 1.102.3 on a Running node with HTTPS certs enabled: top-level
`CertDomains` is `["philipps-macbook-pro-m5.tailb2e719.ts.net"]`, `Self`
`DNSName` is `philipps-macbook-pro-m5.tailb2e719.ts.net.`, and `Self` has zero
keys containing "Cert".

**Consequence: every plain `gtd ui` on any tailnet refuses**, HTTPS certs
enabled or not, with "HTTPS is mandatory and no certificate is configured".
`certDomains` is always `[]`, so `resolveCertPair`'s `tailscale cert` branch is
unreachable and control falls through to the refusal.

Hostname detection still works — the `DNSName` fallback supplies it — which is
why the printed URL and QR code look correct under `--self-signed` while the
certificate path is dead.

**The tests do not catch it because the fixtures share the bug.** Both
`src/ui/Tailscale.test.ts` and `src/ui/Server.test.ts` build status payloads
with the same wrong `Self: { CertDomains: [...] }` shape. Parser and fixtures
agree with each other and disagree with Tailscale.

The fix: move `CertDomains` to the top level of the raw status type, read it
there, keep `Self.DNSName` as the hostname fallback, and reshape both fixture
sets so they match real output. Acceptance: a fixture built in real
`tailscale status --json` shape drives `resolveCertPair` into the
`tailscale cert` branch instead of the refusal.
