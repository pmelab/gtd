# Rebuild the committed gtd bundle from the updated src

`scripts/gtd.js` is a committed built artifact produced by `npm run build`
(tsup). Package 01 changed `src/` and `src/prompts/fix-tests.md`, so the
committed bundle is now stale. Regenerate and commit it.

This is a SEPARATE package (depends on package 01's src changes already being
in place) and a single task (it touches `scripts/gtd.js`, which no other task
edits).

## Files

- `scripts/gtd.js` (regenerated output — do not hand-edit)

## Steps

- Run `npm run build`.
- Verify the regenerated `scripts/gtd.js` contains the new behavior:
  - the `Gtd-Test-Fix:` trailer detection / `commitMessages` usage,
  - the `Gtd-Test-Fix: <n>` instruction from the bundled fix-tests prompt.
- Stage the regenerated `scripts/gtd.js`.

## Acceptance criteria

- [ ] `npm run build` completes without error.
- [ ] `scripts/gtd.js` reflects the package-01 src (grep for `Gtd-Test-Fix`
      finds it in the bundle).
- [ ] `npm run test` and `npm run test:e2e` pass with the refreshed bundle.

## Constraints / edge cases

- This package MUST run after package 01 — it bundles package-01 src.
- Only `scripts/gtd.js` should change (plus any tsup-managed sourcemaps if the
  build emits them). Do not hand-edit the bundle; regenerate it.
