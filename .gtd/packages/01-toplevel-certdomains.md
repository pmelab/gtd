# Read `CertDomains` from the top level of `tailscale status --json`

## Requirement

**The Tailscale certificate branch is dead code — `CertDomains` is read off
`Self`, where it does not exist.**

In real `tailscale status --json` output `CertDomains` is a TOP-LEVEL field.
`Self` carries `DNSName` and no `CertDomains` key at all. Confirmed against
tailscale on a `Running` node with HTTPS certs enabled: top-level `CertDomains`
is `["philipps-macbook-pro-m5.tailb2e719.ts.net"]`, `Self.DNSName` is
`"philipps-macbook-pro-m5.tailb2e719.ts.net."`, and `Self` has zero keys
matching `/Cert/i`.

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

Move `CertDomains` to the top level of the raw status type and read it there.
Keep `Self.DNSName` as the hostname fallback, and keep the existing preference
order — top-level `CertDomains[0]` first, because it carries no trailing dot;
stripped `DNSName` second.

**Every existing empty case must keep resolving to `undefined`, never a failed
Effect** — unparseable JSON, backend not `Running`, missing `Self`, MagicDNS
off. The MagicDNS-off case now means "no top-level `CertDomains` AND no usable
`Self.DNSName`". The certs-disabled-but-MagicDNS-on case (no top-level
`CertDomains`, `Self.DNSName` present) must still yield a hostname and an empty
`certDomains`, i.e. the refusal.

The fixtures diverging from reality is the actual defect. **At least one fixture
must be a verbatim capture of real `tailscale status --json` shape**, marked as
such at the code, so a future reshape has a ground truth to check against rather
than another hand-written guess.

### Settled technical decisions

`Self.CertDomains` is removed from the raw type outright, not kept as an
optional fallback: an optional slot would let a future hand-written fixture pass
the pre-fix shape and go green, re-creating the exact drift this fixes.

The verbatim capture lives inline in `src/ui/Tailscale.test.ts`, not in a
separate JSON fixture file — it keeps the ground truth beside the parser test
and raises no `turbo.json` `inputs` question.

`resolveCertPair` fires on `certDomains[0]` unchanged even when that name is not
the host the browser dials. Real top-level `CertDomains` on a node is the node's
own name, matching `displayHost`; a matching rule would be speculation, and the
settled policy of failing outright on a bad `tailscale cert` covers the
broken-tailnet case.

`src/ui/Server.ts` gets no edit. `probeTailscaleStatus` is untouched. The public
`TailscaleStatus` shape `{ hostname, certDomains }` is unchanged.

## Tasks

### 1. Move `CertDomains` to the top level of the raw type and the read site

Paths: `src/ui/Tailscale.ts`

- [ ] `RawTailscaleStatus` declares `readonly CertDomains?: readonly string[]`
      at the top level, alongside `BackendState`
- [ ] `RawTailscaleStatus["Self"]` declares `DNSName` only — no `CertDomains`
      key remains anywhere under `Self`
- [ ] `parseTailscaleStatus` reads `parsed.CertDomains ?? []`
- [ ] Preference order is unchanged: `certDomains[0]` first, then `Self.DNSName`
      with a single trailing dot stripped
- [ ] The `parsed.Self === undefined` guard still returns `undefined` even when
      a top-level `CertDomains` is present
- [ ] `TailscaleStatus`, `probeTailscaleStatus`, and `src/ui/Server.ts` are
      unmodified

### 2. Reshape the `Tailscale.test.ts` fixtures to the real shape

Paths: `src/ui/Tailscale.test.ts`

- [ ] The `running()` helper takes a second optional argument for top-level
      fields, so every existing one-argument call site still compiles
- [ ] The certs-enabled parse test passes `CertDomains` at the top level and
      asserts `{ hostname: <name>, certDomains: [<name>] }`
- [ ] The `BackendState: "Stopped"` test and the missing-`Self` test — both
      built inline rather than through `running()` — carry the same reshape
- [ ] The `probeTailscaleStatus` happy-path test payload carries top-level
      `CertDomains`
- [ ] No fixture in the file nests `CertDomains` under `Self`

### 3. Pin every empty case after the reshape

Paths: `src/ui/Tailscale.test.ts`

- [ ] Unparseable JSON returns `undefined`
- [ ] `BackendState !== "Running"` returns `undefined`
- [ ] Missing `Self` returns `undefined`
- [ ] MagicDNS off — no top-level `CertDomains` and `Self.DNSName` absent —
      returns `undefined`
- [ ] MagicDNS off — no top-level `CertDomains` and `Self.DNSName` an empty
      string — returns `undefined`
- [ ] Certs disabled but MagicDNS on — no top-level `CertDomains`,
      `Self.DNSName` present — returns a stripped hostname and `certDomains: []`
- [ ] `probeTailscaleStatus` resolves `undefined`, never a failed Effect, on a
      spawn failure and on a non-zero exit

### 4. Add the verbatim real-capture fixture

Paths: `src/ui/Tailscale.test.ts`

- [ ] One fixture is a verbatim capture of real `tailscale status --json`
      output, inline in the test file
- [ ] A comment at that fixture states it is a real capture and names its
      source, so a future reshape has a ground truth
- [ ] The capture keeps the real field spread a hand-written fixture omits —
      `Version`, `TUN`, `HaveNodeKey`, `TailscaleIPs`, the full `Self` object,
      `MagicDNSSuffix`, `CurrentTailnet` — with node identity redacted to the
      `tailb2e719.ts.net` names and `Peer` reduced to `{}`
- [ ] Top-level `CertDomains` is `["philipps-macbook-pro-m5.tailb2e719.ts.net"]`
- [ ] `Self.DNSName` is `"philipps-macbook-pro-m5.tailb2e719.ts.net."` and
      `Self` carries no key matching `/Cert/i`
- [ ] `parseTailscaleStatus` on the capture returns
      `{ hostname: "philipps-macbook-pro-m5.tailb2e719.ts.net", certDomains:     ["philipps-macbook-pro-m5.tailb2e719.ts.net"] }`

### 5. Prove the cert branch is reachable end to end

Paths: `src/ui/Server.test.ts`

- [ ] The single status payload literal in the probe-answers test carries
      top-level `CertDomains`, not `Self.CertDomains`
- [ ] A test in real `tailscale status --json` shape drives `resolveCertPair`
      with `selfSigned: false` and no configured cert/key pair into the
      `tailscale cert` branch — not into the "HTTPS is mandatory and no
      certificate is configured" refusal
- [ ] That test fails against the pre-change parser (the branch is unreachable)
      and passes after
- [ ] With no top-level `CertDomains` and `Self.DNSName` present,
      `resolveCertPair` still fails with the "HTTPS is mandatory" `GtdError`
- [ ] `npm test` is green
