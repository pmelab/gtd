# Review: 1a2b3c4

<!-- base: 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b -->

## Parser accepts CRLF[^th1]

**Line endings are normalized before the split.** Also normalize in the writer.

- [x] ./src/parse.ts#10-14 — normalizes `\r\n` first
- [ ] ./src/parse.ts#30-31 — Risk: a lone `\r` is still kept as content. Treat
      it as a line break too.

[^th1]: - H: Is the writer in scope?

## Tests

- [x] ./src/parse.test.ts#1-40 — one case per line ending[^fn1]

[^fn1]: Add a mixed-endings case.
