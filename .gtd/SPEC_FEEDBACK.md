# Spec feedback — 04 Findings and outlines that point at the offending token

The package is otherwise complete: every task's criteria are implemented and
covered, `npm test` is green, `docs/cli.md` is untouched as predicted. Three
concrete problems remain.

## 1. Two stacked doc comments on `checkSectionOrder` — `src/OpenQuestions.ts:324`

`checkSectionOrder` carries TWO consecutive `/** … */` blocks (lines 324–339 and
340–347). The second one is the one that applies; the first is dead prose that
restates the same rule AND is the only place a "Known gap, out of this package's
scope" note about a 4+-space-indented `## Open Questions` heading lives — so
that note is now orphaned ahead of an unrelated comment rather than attached to
anything.

Collapse them into one block. Whatever of the known-gap note is still true
belongs in that single block (or at the code it constrains); the duplicated
restatement of the ordering rule goes away.

## 2. The bare-`./path` document-link branch has no test

Criterion: "the link resolves `#42` from 1-based to 0-based, and a bare `./path`
with no `#line` lands at line 0". Only the first half is covered
(`src/Lsp.test.ts:277` asserts `./src/a.ts#1` → `…#L1`). The `: 0` branch of
`hunkLinkFor` (`src/ReviewDoc.ts:738`) is exercised by nothing — the existing
line-0 test at `src/ReviewDoc.test.ts:746` covers `pointerAt`, not
`documentLinks`, which is a different function with its own line computation.

Add a `documentLinks` assertion for a hunk written as `- [ ] ./src/a.ts` (no
`#line`), pinning `line: 0` / target `…#L1`.

## 3. `src/SteeringFormat.test.ts:28` claims coverage it does not have

The sample is labelled "qa: bare heading, misordered sections, indented dropped
heading/option" and includes `    #### dropped heading`. `HEADING_SHAPE_RE` is
`/^#{3}(?:\s|$)/`, so `####` does not match it — that line produces no finding
at all, and the indented-HEADING shape is never exercised by this test. The
`it.each` only asserts `findings.length > 0`, so the suite stays green on the
strength of the other findings in the same document.

Use `    ### dropped heading` (three hashes), or drop the phrase from the label.
As written the test's name misreports what the invariant check covers.
