# Requirements

## The served page carries no styling at all

PRODUCT. The human's note on `.gtd/REVIEW.md`: "styles are not loaded (at least
in development mode)". The phone client renders unstyled.

There is no stylesheet, no `<style>` tag, and no `.css` file anywhere in
`src/web` — `Highlight.ts`'s own doc comment states this outright, and
`src/web/index.html` sets nothing beyond `charset`, the viewport meta, and a
title. No `body` background, no text color, no font stack, no `color-scheme`.

Components meanwhile hardcode dark-surface colors and expect a dark page under
them: `Refusal.tsx#124` (`#111` / `#3a2a00` with a `#333` border),
`NoteSheet.tsx#199` (`#111`), `Hunk.tsx#111` and `#119` (`#3a2a00`), and
`Highlight.ts`'s syntax palette (`#6a9955`, `#ce9178`, `#569cd6`) which is a
dark-editor token set. On a default white document with black text, those dark
chips read as broken paint, not as a theme.

**Nothing in the change under review touched styling — this is a standing gap,
not a regression from this round.**

**Correction to this round's earlier reading: the dropped-asset problem is NOT
dev-only.** Both delivery paths read exactly two files and nothing else.
`scripts/inline-web-client.mjs` reads `src/web/index.html` plus
`dist/web/main.js` and folds them into `src/web/generated.html`; `--dev`'s
`resolveClientHtml` (`Server.ts#204`, `#229`) reads the same two at startup. Any
`.css` the `tsdown --filter web` build emits alongside `main.js` is dropped on
the floor in production too. `src/ui/scriptTag.mjs`'s `SCRIPT_TAG_PATTERN` is
the single inline seam, and it matches a `<script type="module" src>` tag only —
a `<link rel="stylesheet">` has no equivalent handler and raises no error, it
simply resolves to nothing in the browser.

**So a build-emitted stylesheet is the one shape that cannot work without also
extending both inline paths.** The shapes that need no build change: an inline
`<style>` block in `src/web/index.html`, or styles injected from `main.tsx`
itself. Note the inline-script step already throws a named error when its tag
goes missing — any new seam should fail as loudly rather than silently serve an
unstyled page.

**The theme is dark only** — the human's answer. That makes this concern a page
shell and nothing more: a `body` background, a text color, a font stack, and
`color-scheme: dark` so form controls and scrollbars follow. **Every hardcoded
color already in the components stays exactly as it is** — `#111`, `#3a2a00`,
`#333`, and `Highlight.ts`'s `#6a9955`/`#ce9178`/`#569cd6` are already a
dark-surface set, so no component and no syntax palette is touched.

`color-scheme: dark` is the one line that must not be dropped for brevity:
without it a phone in light mode still paints white form controls and a white
scrollbar over the dark page.

Acceptance: a check that the served HTML carries a page background and text
color — failing today against both `generated.html` and the `--dev` template.

## Emit the Tailscale URL, not just the bound IP

PRODUCT. The human's second note on `.gtd/REVIEW.md`: "if available, it should
detect tailscale and emit the tailscale url".

`Server.ts#487` prints `https://${host}:${bound.port}/` and renders that same
string as the QR code, where `host` is whatever `resolveBindHost` produced. With
no `--host` and no `ui.host`, that is the raw CGNAT address
`pickBindHostFromSystem` scraped out of `os.networkInterfaces()` — a bare
`100.64.0.0/10` IP like `https://100.90.1.2:8443/`.

**This concern reverses a committed decision, so `Bind.ts`'s doc comment must be
rewritten as part of it, not left behind.** That comment currently reads:
"Scanning for this avoids shelling out to a `tailscale` binary, which is not
installed on this machine and not worth acquiring." The premise is false —
`tailscale` is installed at `/opt/homebrew/bin/tailscale` and
`tailscale status --json` answers. A stale comment asserting the opposite of the
code is worse than none.

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

Two structural constraints this lands into. First, `host` today is one string
serving two jobs — the socket bind address and the printed URL — and this
concern splits them: bind stays the CGNAT IP, display becomes the hostname.
Second, `pickBindHostFromSystem` exists specifically so that `program.test.ts`,
`Server.test.ts`, and `ui.steps.ts` can mock the real-system call without
stubbing pure logic; a Tailscale probe needs the same split — a pure parser over
the JSON plus a thin system entry point — or those three mock sites go stale.
`CommandRunner` is already in `resolveCertPair`'s requirements, so the
subprocess itself needs no new plumbing.

`Tls.ts`'s `SelfSignedCertRequest` already models exactly the split this
creates: `host` for the SAN's `DNS:` entry and an optional `ip` for its `IP:`
entry, so a hostname URL over an IP bind needs both filled in — a shape it
already supports, not a change.

**The concern extends to obtaining the real certificate — the human's answer —
so it now covers the hostname URL and a `tailscale cert` branch together.** A
hostname URL is the only URL a real Tailscale-issued certificate can ever match,
and a self-signed cert for a CGNAT IP is a browser warning on every load; the
two halves have no separate acceptance, so they stay one concern.

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
own doc comment.** The comment currently reads that neither `--self-signed` nor
a configured pair present "is a refusal, not a silent default to self-signed —
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

Acceptance: with a fake `tailscale status --json` reporting a running backend,
the printed URL and QR code carry the tailnet hostname; with the probe empty,
they carry the IP exactly as today.

## Answered Questions

### Which theme should the phone client paint — dark, light, or a `prefers-color-scheme` pair?

Dark only. It matches every color already hardcoded in the components, so the
concern is a page shell with no component changes and no light-variant palette.

### Does the Tailscale work stop at the emitted URL, or also obtain a real certificate?

It also obtains a real certificate via `tailscale cert`, which becomes the
default when Tailscale is present and the tailnet has HTTPS enabled.

### Should the tailnet hostname also become the socket bind address?

No. The server keeps binding to the CGNAT IP and only displays the hostname —
binding by name adds a DNS resolution to the startup path for no user-visible
gain, and `Tls.ts` already supports a SAN carrying both.

### Is the styling gap two concerns — a page shell and a component-color pass?

No, one. A page shell that leaves the hardcoded component colors unreadable has
no acceptance check that passes, so the two cannot land separately.
