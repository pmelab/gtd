# Task: Ignore the downloaded/built bundle and its temp file

## Description

The launcher shim downloads (or `npm run build` copies) the real bundle to
`scripts/gtd.bundle.mjs`, using `scripts/gtd.bundle.mjs.tmp` as an atomic-write
staging path. Neither should ever be tracked by git.

Add these two entries to `.gitignore`:

```
scripts/gtd.bundle.mjs
scripts/gtd.bundle.mjs.tmp
```

Place them under a clear comment (e.g. `# downloaded/built CLI bundle`). Keep
the existing `dist` ignore entry as-is. Do NOT remove or reorder unrelated
entries.

Do NOT edit `scripts/gtd.js`, `.prettierignore`, or `.gitattributes` — sibling
tasks own those.

## Acceptance criteria

- [ ] `.gitignore` contains `scripts/gtd.bundle.mjs`.
- [ ] `.gitignore` contains `scripts/gtd.bundle.mjs.tmp`.
- [ ] Existing ignore entries (including `dist`) are unchanged.

## Files

- `/Users/pmelab/Code/gtd/gtd/.gitignore`
