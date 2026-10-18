# Review: cdd7a74

<!-- base: 659ef2225de0421d30dcfc2c8114519fa691f0ab -->

One docs-only change. No `.feature` scenario added or changed, so no Scenarios
chunk.

## Scope SDLC.md's flag-gated trailer line

**The #371 "known gap" line becomes a plain scope statement: `seam.judge`
judgments need `GTD_FLAG_NAIVE_PASS`, risk-tier trailers need both
`GTD_FLAG_RISK_TIER` and `GTD_FLAG_NAIVE_PASS`.** Matches the code: the
naive-pass path runs only when `flag_naive_pass` is `"1"`, and the risk-tier
check requires both flags. `(#371)` is gone, no module is named,
`oxfmt --check SDLC.md` passes. No other file touched.

Squash message must still carry the `docs(...)` type and `Closes #371`; that
lives in merge metadata, not this diff.

- [ ] ./SDLC.md#77-79 — swaps the `(#371)` gap line for the flag scope line
