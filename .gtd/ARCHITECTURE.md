# Architecture

## Read `CertDomains` from the top level of `tailscale status --json` (TECHNICAL)

Primary paths: `src/ui/Tailscale.ts`, `src/ui/Tailscale.test.ts`,
`src/ui/Server.test.ts`.

**The whole fix is three lines of parser and a fixture reshape — nothing
downstream changes.** `resolveCertPair` already reads
`tailscaleStatus?.certDomains[0]` and already has the `tailscale cert` branch
wired behind it; it is starved of input, not miswired. `src/ui/Server.ts` gets
no edit.

### Data model

`RawTailscaleStatus` in `src/ui/Tailscale.ts` moves `CertDomains` out of `Self`
and up one level:

    interface RawTailscaleStatus {
      readonly BackendState?: string
      readonly CertDomains?: readonly string[]
      readonly Self?: { readonly DNSName?: string }
    }

`Self` keeps `DNSName` only. Dropping the `Self.CertDomains` slot entirely is
deliberate: leaving it optional would let a hand-written fixture keep passing
the wrong shape silently, which is the exact drift this concern exists to kill.

`TailscaleStatus` — the module's public shape, `{ hostname, certDomains }` — is
unchanged. That is what keeps the blast radius inside one file: every consumer
sees the same interface, now actually populated.

### Parse order and the empty cases

`parseTailscaleStatus` keeps its structure and its four early `undefined`
returns. Only the read site moves:

    const certDomains = parsed.CertDomains ?? []
    const dnsName = parsed.Self.DNSName

Preference order stands: `certDomains[0]` first (no trailing dot), then
`DNSName` with its trailing dot stripped. The `parsed.Self === undefined` guard
stays ahead of both — a payload with a top-level `CertDomains` but no `Self` is
still `undefined`, because hostname resolution is what the caller needs and
`Self` is where the fallback lives.

### Error handling

Unchanged, and load-bearing. **Every empty case resolves to `undefined`, never a
failed Effect** — unparseable JSON, `BackendState !== "Running"`, missing
`Self`, and MagicDNS off. MagicDNS off now means _no top-level `CertDomains` and
no usable `Self.DNSName`_ (absent or empty string); that second condition is
what the existing `hostname === undefined || hostname === ""` guard already
covers, so it needs no new code but does need its own test after the reshape.

The certs-disabled-but-MagicDNS-on case is the one that must keep refusing: no
top-level `CertDomains`, `Self.DNSName` present →
`{ hostname, certDomains: [] }` → `resolveCertPair` falls to the "HTTPS is
mandatory" `GtdError`. Losing that would turn a refusal into a `tailscale cert`
call on a tailnet that cannot issue one.

`probeTailscaleStatus` is untouched.

### Fixtures

`Tailscale.test.ts`'s `running()` helper currently takes only a `Self` object
and hard-codes `BackendState`. It grows a second slot so a test can express
top-level fields:

    const running = (self: Record<string, unknown>, top: Record<string, unknown> = {}): string =>
      JSON.stringify({ BackendState: "Running", ...top, Self: self })

Every existing call site keeps working with one argument; the certs-enabled
tests pass `{ CertDomains: [...] }` as the second. The two tests that build
their payload inline rather than through `running()` — the
`BackendState: "Stopped"` case and the missing-`Self` case — get the same
reshape by hand.

`Server.test.ts` has exactly one payload literal, at the probe-answers test
(around line 577). It moves `CertDomains` to the top level in place. That test
is the end-to-end proof: it drives a real `runUiCommand` with
`selfSigned: false` and no configured pair, so before this change it hits the
refusal and after it hits `obtainTailscaleCert`.

### Ground-truth fixture

**One fixture is a verbatim capture of real `tailscale status --json`, inline in
`Tailscale.test.ts`, with a comment at the code saying so and naming the
capture's source.** Not a new JSON file under `src/` — inline keeps the ground
truth in the reader's eye next to the parser test, and adds no `turbo.json`
`inputs` question. The capture keeps the real field spread that a hand-written
fixture omits — `Version`, `TUN`, `HaveNodeKey`, `TailscaleIPs`, the full `Self`
object, `MagicDNSSuffix`, `CurrentTailnet` — with the node identity redacted to
the `tailb2e719.ts.net` names the requirement already records, and `Peer`
reduced to `{}`. Verified shape from a `Running` node with certs enabled:
top-level `CertDomains` is `["philipps-macbook-pro-m5.tailb2e719.ts.net"]`;
`Self.DNSName` is `"philipps-macbook-pro-m5.tailb2e719.ts.net."`; `Self` has no
key matching `/Cert/i`.

The risk this fixture exists to catch: a future reshape checks itself against
another hand-written guess and both agree with each other while disagreeing with
Tailscale — which is precisely how the current bug survived two test files.

### Acceptance

A fixture in real `tailscale status --json` shape drives `resolveCertPair` into
the `tailscale cert` branch instead of the refusal — fails before this change
because the branch is unreachable, passes after. `npm test` is green today, so
this starts from green and must end green.

## Answered Questions

### When `certDomains[0]` is not the hostname the browser will dial, should the cert branch still fire?

Yes — fire on `certDomains[0]` unchanged. This mismatch becomes reachable for
the first time only because the branch starts working at all, but real top-level
`CertDomains` on a node is the node's own name, matching `displayHost`; adding a
matching rule now would be speculation, and the already-settled policy of
failing outright on a bad `tailscale cert` covers the broken-tailnet case.

### Should the verbatim capture live in a separate JSON fixture file or inline in the test?

Inline in `src/ui/Tailscale.test.ts`. A separate file puts the ground truth one
hop away from the parser test that depends on it and raises a `turbo.json`
`inputs` question for no gain; the capture is read once, by a human checking a
reshape.

### Should `Self.CertDomains` stay in the raw type as a deprecated fallback?

No — remove it outright. Keeping an optional `Self.CertDomains` read would let a
future hand-written fixture pass the pre-fix shape and go green, re-creating the
exact drift this concern fixes.
