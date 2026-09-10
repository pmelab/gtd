# 01 — Remove the QR code

All four spec criteria of Task 1 and all three of Task 2 hold:
`Qr.ts`/`Qr.test.ts` gone, no `./Qr.js` import anywhere, `Server.ts` prints one
line (`url`) then `out.flush()`, `deadcode` clean, no
`qrcode-terminal`/`@types/qrcode-terminal` in `package.json`, all three
address-selection tests present asserting only `written[0]`, `npm test` green.

One stale reference survives the deletion:

- `tests/integration/features/ui.feature:261` — comment still reads
  "printed-URL/QR-code-carries-the-tailnet-hostname coverage", pointing a reader
  at unit-tier QR assertions that no longer exist. Drop the "/QR-code" from that
  phrase; the rest of the comment (unit-tier probe coverage lives in
  `Server.test.ts`) is still accurate. `ui.feature` is not in the spec's path
  list, so this is the only edit outside it.
