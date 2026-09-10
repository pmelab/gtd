# Feedback — 01 Remove the QR code

Tasks 1 and 2 are done and their criteria hold: `src/ui/Qr.ts`/`Qr.test.ts` are
gone, the `out.write` and both imports are gone, `package.json` and
`package-lock.json` no longer carry `qrcode-terminal` or
`@types/qrcode-terminal`, `npm run deadcode` is clean, `npm test` is green, and
all three address-selection tests survive asserting only `written[0]`.

Three leftovers still name the removed dependency and the removed behaviour.

## 1. `tsdown.config.ts#45-52` — dead bundler exception for the deleted dependency

The `deps.alwaysBundle: (id) => !id.includes("qrcode-terminal")` escape hatch
exists only to keep `qrcode-terminal` external, and its comment asserts a fact
that is now false: "it's already an npm `dependencies` entry, so `npm install`
still provides it". Nothing installs it any more. The spec's requirement is
"remove it, its module, and its dependency — not just the call site"; this is
the last live reference to the dependency in the repo. Remove the exception and
its comment (the whole `deps` block, unless something else needs it).

## 2. Three test titles in `src/ui/Server.test.ts` still promise a QR code

The bodies assert one written line; the titles claim two:

- `#594` — "prints the https:// URL on its own line, then a QR code encoding
  that exact URL, before blocking"
- `#630` — "... and the QR code encoding that same URL ..."
- `#675` — "prints the CGNAT IP, exactly as before, as both the displayed URL
  and the QR code when the probe finds no backend"

Rewrite each title to describe what it now pins — the display-URL versus
bind-host split — with no mention of a QR code.

## 3. Two stale comments referencing the QR code

- `src/ui/Server.test.ts#177` — "the printed URL/QR code said" in the SAN
  regression comment.
- `src/ui/Tailscale.ts#41` — "before it lands in a URL or a QR code".

Both should drop the QR half; the rest of each comment stays.
