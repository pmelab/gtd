# Rebuild the committed gtd bundle from the updated src

`scripts/gtd.js` is a committed built artifact produced by `npm run build`
(tsup). Package 01 changed `src/Git.ts`, `src/Events.ts`, and
`src/prompts/review-process.md`, so the committed bundle is now stale. Regenerate
and commit it.

This is a SEPARATE package (depends on package 01's src + prompt changes being in
place) and a single task (it touches `scripts/gtd.js`, which no other task edits).

## Files

- `scripts/gtd.js` (regenerated output — do not hand-edit)

## Steps

- Run `npm run build`.
- Verify the regenerated `scripts/gtd.js` reflects package 01:
  - `grepBangAdded` appears (and `grepBang(` as the old pathspec method is gone),
  - the bundled review-process prompt no longer says "strip the `!!` comments
    from the source" and describes the added-line-since-review semantics.
- Stage the regenerated `scripts/gtd.js`.

## Acceptance criteria

- [ ] `npm run build` completes without error.
- [ ] `scripts/gtd.js` reflects the package-01 src (grep for `grepBangAdded`
      finds it; the old `grepBang` pathspec method is absent).
- [ ] `npm run test` and `npm run test:e2e` pass with the refreshed bundle.

## Constraints / edge cases

- This package MUST run after package 01 — it bundles package-01 src and prompt.
- Only `scripts/gtd.js` should change (plus any tsup-managed sourcemaps if the
  build emits them). Do not hand-edit the bundle; regenerate it.
- The e2e suite rebuilds at runtime, so package 01 already passed e2e; this
  package refreshes the committed artifact so the shipped CLI matches src.
