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
not a regression from this round.** It is visible from either path; the human
hit it under `--dev`.

One dev-path mechanism to rule out while fixing this: `--dev` inlines exactly
`dist/web/main.js` into `src/web/index.html` (`Server.ts#readDevTemplate` and
`#rebuildDevClientScript`). Any asset the `tsdown --filter web` build emits
alongside `main.js` is dropped on the floor, so a stylesheet introduced as a
build output — rather than inline styles or an inline `<style>` — would silently
never reach the browser under `--dev` even after this concern is otherwise
satisfied.

Deciding the theme itself (dark to match the existing colors, light to match the
default document, or a `prefers-color-scheme` pair) is not settled here.

## Emit the Tailscale URL, not just the bound IP

PRODUCT. The human's second note on `.gtd/REVIEW.md`: "if available, it should
detect tailscale and emit the tailscale url".

`Server.ts#487` prints `https://${host}:${bound.port}/` and renders that same
string as the QR code, where `host` is whatever `resolveBindHost` produced. With
no `--host` and no `ui.host`, that is the raw CGNAT address
`pickBindHostFromSystem` scraped out of `os.networkInterfaces()` — a bare
`100.64.0.0/10` IP like `https://100.90.1.2:8443/`.

The tailnet already carries a name for that machine. When Tailscale is present
and reports one, the printed URL and its QR code should use the tailnet hostname
instead of the numeric address, falling back to today's IP when it is absent —
and never overriding an explicit `--host`/`ui.host`, which
`Server.ts#resolveBindHost` already treats as the user's own deliberate consent.

**A hostname URL is also the only URL a real Tailscale-issued certificate can
ever match; a self-signed cert for a CGNAT IP is a browser warning on every
load.** Whether this concern extends to obtaining that certificate, or stops at
the emitted URL and QR code, is left open.
