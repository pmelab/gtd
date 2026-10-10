# Review: 1a2b3c4

<!-- base: 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b -->

## Parser accepts CRLF

**Line endings are normalized before the split.**

- [ ] ./src/parse.ts#10-14 — normalizes `\r\n` first
- [ ] ./src/parse.ts#30-31 — Risk: a lone `\r` is still kept as content

## Tests

- [ ] ./src/parse.test.ts#1-40 — one case per line ending
