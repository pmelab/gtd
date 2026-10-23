# Review: 1a2b3c4

<!-- base: 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b -->

## Findings

### A lone CR is kept

_should: contract_

The parser keeps a lone `\r` as content.

In the code:

- [x] ./src/parse.ts#30-31 — where it is kept

Tick exactly one:

- [ ] fix as suggested
- [x] won't fix
- [ ] _your answer_

## Walkthrough

### Parser accepts CRLF

- [ ] ./src/parse.ts#10-14 — normalizes `\r\n` first

## Fixed automatically

- a test name typo (0123456)
