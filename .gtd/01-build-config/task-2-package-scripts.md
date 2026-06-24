# Task: Add postbuild copy + e2e prebuild scripts to package.json

## Description

The build now emits `dist/gtd.bundle.mjs`. For local dev and offline e2e tests,
the launcher shim expects the bundle at `scripts/gtd.bundle.mjs`. Wire that up
via npm scripts so a local `npm run build` makes the shim work immediately
without a network round-trip, and so e2e tests run offline/deterministically.

Add to the `scripts` block in `package.json`:

- `"postbuild": "node -e \"require('fs').copyFileSync('dist/gtd.bundle.mjs','scripts/gtd.bundle.mjs')\""`
  — copies the freshly built bundle next to the shim after every `npm run build`.
  (Use a Node one-liner so it is cross-platform; do not rely on a shell `cp`.)
- `"pretest:e2e": "npm run build"` — ensures `dist/gtd.bundle.mjs` exists and is
  copied to `scripts/gtd.bundle.mjs` (via `postbuild`) before the cucumber e2e
  suite runs, so the shim never attempts a network download during tests.

Do NOT modify `tsup.config.ts` here (handled by the sibling task). Do NOT touch
the existing `build`, `test`, `test:e2e`, or other entries beyond adding the two
new keys.

## Acceptance criteria

- [ ] `package.json` `scripts` contains a `postbuild` entry that copies
      `dist/gtd.bundle.mjs` → `scripts/gtd.bundle.mjs` using a cross-platform
      Node one-liner.
- [ ] `package.json` `scripts` contains `"pretest:e2e": "npm run build"`.
- [ ] `package.json` remains valid JSON.
- [ ] `npm run build` leaves `scripts/gtd.bundle.mjs` present afterward.
- [ ] `npm test` (vitest) passes.

## Files

- `/Users/pmelab/Code/gtd/gtd/package.json`
