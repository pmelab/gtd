# 01 — Remove the QR code

## Requirement

The QR code printed on server start has no purpose. Remove it, its module, and
its dependency — not just the call site.

- `src/ui/Server.ts#584` — the sole `renderQrCode(url)` write, one line below
  the `url` write. The `url` line immediately above it stays.
- `src/ui/Server.ts#28` — the `renderQrCode` import.
- `src/ui/Qr.ts`, `src/ui/Qr.test.ts` — the module (14 lines) and its test.
- `package.json#118`, `package.json#77` — `qrcode-terminal` and
  `@types/qrcode-terminal`.

`npm run deadcode` (`fallow --summary --quiet`) reds on both an unreferenced
`Qr.ts` and an unused dependency, so the module deletion and the two
`package.json` lines are one atomic change — dropping the file without the deps
fails the gate. `package.json` sits in `turbo.json`'s `globalDependencies`, so
every cached task re-runs on this change; there is no stale green to design
around.

Risk: three tests in `src/ui/Server.test.ts` assert the QR line (`#628`, `#679`,
`#720`), and they are NOT QR tests. They pin the Tailscale-hostname probe and
the CGNAT-IP fallback — which address gets bound versus which gets printed.
Deleting them to make the suite green silently drops that coverage. Rewrite each
to assert the URL only.

## Task 1 — Delete the module, its call site, and its dependency

One commit, all four edits together — the `deadcode` gate reds on any subset.

`src/ui/Server.ts` loses the `renderQrCode` import (`#28`) and the
`out.write(...)` QR line (`#584`). The `url` write directly above it and the
`out.flush()` directly below it stay byte-identical. `src/ui/Qr.ts` and
`src/ui/Qr.test.ts` are deleted outright — no other module imports either.

`package.json` loses `qrcode-terminal` (`#118`) and `@types/qrcode-terminal`
(`#77`); run `npm install` so `package-lock.json` matches, and commit the lock
change with it.

Paths: `src/ui/Server.ts`, `src/ui/Qr.ts`, `src/ui/Qr.test.ts`, `package.json`,
`package-lock.json`.

- [ ] `src/ui/Qr.ts` and `src/ui/Qr.test.ts` no longer exist, and no file
      imports `./Qr.js`
- [ ] `src/ui/Server.ts` prints exactly one line on start — the URL — followed
      by the unchanged `out.flush()`
- [ ] `npm run deadcode` reports no unreferenced module and no unused dependency
- [ ] `package.json` names neither `qrcode-terminal` nor
      `@types/qrcode-terminal`, and `package-lock.json` matches

## Task 2 — Rewrite the three address-selection tests to assert the URL only

`src/ui/Server.test.ts` drops its `./Qr.js` import (`#28`). Each of the three
tests keeps its `written[0]` URL assertion and loses only its `written[1]` line
(`#628`, `#679`, `#720`), plus the comment at `#627` that explains the QR line's
coupling to the printed URL.

Nothing after them re-indexes: `written[1]` was the last index each of the three
read, and the helper at `#1060` already reads `written[0]` only.

Do not delete a test to reach green. All three exist to pin address selection —
the Tailscale-hostname probe and the CGNAT-IP fallback — and that coverage must
survive this package intact.

Paths: `src/ui/Server.test.ts`.

- [ ] all three tests are still present, each asserting exactly one written
      line, `written[0]`, equal to its expected URL
- [ ] `src/ui/Server.test.ts` contains no reference to `renderQrCode` or
      `./Qr.js`
- [ ] `npm test` green
