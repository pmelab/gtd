# Task: Point .gitattributes at the bundle, not the shim

## Description

The `-diff linguist-generated` attribute exists to suppress the textual diff of
the giant generated bundle so `gtd review` diffs stay small. That bundle is now
`scripts/gtd.bundle.mjs` (gitignored, so this is mostly defensive) — the
hand-written shim at `scripts/gtd.js` SHOULD show normal diffs.

Update `.gitattributes`: replace the `scripts/gtd.js -diff linguist-generated`
entry with `scripts/gtd.bundle.mjs -diff linguist-generated` and update the
comment to refer to the downloaded/built bundle.

Do NOT edit `scripts/gtd.js`, `.gitignore`, or `.prettierignore` — sibling tasks
own those.

## Acceptance criteria

- [ ] `.gitattributes` no longer references `scripts/gtd.js`.
- [ ] `.gitattributes` has `scripts/gtd.bundle.mjs -diff linguist-generated`.

## Files

- `/Users/pmelab/Code/gtd/gtd/.gitattributes`
