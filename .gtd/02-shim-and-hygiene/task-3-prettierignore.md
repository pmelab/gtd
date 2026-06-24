# Task: Point .prettierignore at the bundle, not the shim

## Description

`scripts/gtd.js` is no longer the generated bundle — it is a hand-written shim
that SHOULD be formatted. The generated artifact is now
`scripts/gtd.bundle.mjs`. Update `.prettierignore` so prettier ignores the
generated bundle and formats the shim.

Replace the `scripts/gtd.js` entry with `scripts/gtd.bundle.mjs` and update the
comment to refer to the downloaded/built bundle.

Do NOT edit `scripts/gtd.js`, `.gitignore`, or `.gitattributes` — sibling tasks
own those.

## Acceptance criteria

- [ ] `.prettierignore` no longer lists `scripts/gtd.js`.
- [ ] `.prettierignore` lists `scripts/gtd.bundle.mjs`.
- [ ] `npm run format:check` passes (the shim from the sibling task is already
      prettier-formatted; confirm no new violations).

## Files

- `/Users/pmelab/Code/gtd/gtd/.prettierignore`
