# Rebuild the committed gtd bundle from the updated src

`scripts/gtd.js` is a committed built artifact produced by `npm run build`
(tsup). Package 01 changed `src/Machine.ts` and `src/prompts/human-review.md`,
so the committed bundle is now stale. Regenerate and commit it.

This is a SEPARATE package (depends on package 01's src + prompt changes being
on disk) and a single task (it touches only `scripts/gtd.js`, which no other
task edits).

## Files

- `scripts/gtd.js` (regenerated output — do not hand-edit)

## Steps

- Run `npm run build`.
- Verify the regenerated `scripts/gtd.js` reflects package 01:
  - the bundled `human-review` machine leaf carries the `auto-advance` tag,
  - the bundled human-review prompt no longer contains "STOP" and instead
    carries the "Re-run gtd — the next cycle commits `REVIEW.md` and deletes the
    marker" instruction.
- Stage the regenerated `scripts/gtd.js`.

## Acceptance criteria

- [ ] `npm run build` completes without error.
- [ ] `scripts/gtd.js` reflects package-01 src: the bundled human-review prompt
      contains the re-run-gtd instruction and no longer contains "STOP"; the
      `human-review` leaf carries `auto-advance`.
- [ ] `npm run test` and `npm run test:e2e` pass with the refreshed bundle.

## Constraints / edge cases

- This package MUST run after package 01 — it bundles package-01 src and prompt.
- Only `scripts/gtd.js` should change (plus any tsup-managed sourcemaps the
  build emits). Do not hand-edit the bundle; regenerate it.
- The e2e suite already rebuilds at runtime
  (`tests/integration/support/hooks.ts` runs `npm run build`), so package 01
  already passed e2e; this package refreshes the COMMITTED artifact so the
  shipped CLI matches src.
