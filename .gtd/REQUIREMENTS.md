# Requirements

## Read `CertDomains` from the top level of `tailscale status --json` (TECHNICAL)

**The Tailscale certificate branch is dead code — `CertDomains` is read off
`Self`, where it does not exist.**

In real `tailscale status --json` output `CertDomains` is a TOP-LEVEL field.
`Self` carries `DNSName` and no `CertDomains` key at all. Re-confirmed this lap
against tailscale on a `Running` node with HTTPS certs enabled: top-level
`CertDomains` is `["philipps-macbook-pro-m5.tailb2e719.ts.net"]`, `Self`
`DNSName` is `philipps-macbook-pro-m5.tailb2e719.ts.net.`, and `Self` has zero
keys matching `/Cert/i`.

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

### The change

Move `CertDomains` to the top level of the raw status type and read it there.
Keep `Self.DNSName` as the hostname fallback, and keep the existing preference
order — top-level `CertDomains[0]` first, because it carries no trailing dot;
stripped `DNSName` second.

Reshape both fixture sets. `Tailscale.test.ts`'s `running()` helper currently
takes only a `Self` object, so it has to grow a top-level slot before any test
can express the real shape; `Server.test.ts` has one payload literal, at the
probe-answers test.

**Every existing empty case must keep resolving to `undefined`, never a failed
Effect** — unparseable JSON, backend not `Running`, missing `Self`, MagicDNS
off. In particular the MagicDNS-off case now means "no top-level `CertDomains`
AND no usable `Self.DNSName`", and the certs-disabled-but-MagicDNS-on case (no
top-level `CertDomains`, `Self.DNSName` present) must still yield a hostname and
an empty `certDomains`, i.e. the refusal.

### Guard against the same drift again

The fixtures diverging from reality is the actual defect; fixing the parser
without fixing that leaves the next reader in the same trap. **At least one
fixture must be a verbatim capture of real `tailscale status --json` shape**,
marked as such at the code, so a future reshape has a ground truth to check
against rather than another hand-written guess.

### Acceptance

A fixture in real `tailscale status --json` shape drives `resolveCertPair` into
the `tailscale cert` branch instead of the refusal — fails before this concern
(the branch is unreachable), passes after. `npm test` is green today, so this
concern starts from green.

## Answered Questions

### When `certDomains[0]` is not the hostname the browser will dial, should the cert branch still fire?

Yes — fire on `certDomains[0]` unchanged. This mismatch becomes reachable for
the first time only because the branch starts working at all, but real top-level
`CertDomains` on a node is the node's own name, matching `displayHost`; adding a
matching rule now would be speculation, and the already-settled policy of
failing outright on a bad `tailscale cert` covers the broken-tailnet case.
