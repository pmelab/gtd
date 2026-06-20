# Task: Move prettier to runtime dependencies

Move `prettier` from `devDependencies` to `dependencies` in `package.json` so
tsup's `noExternal: [/.*/]` inlines it into `scripts/gtd.js`.

## Steps

- Move the `"prettier": "^3.8.1"` entry from `devDependencies` to
  `dependencies`. Keep the same version range.
- Existing `format` and `format:check` npm scripts must keep working unchanged.
- No tsup config changes — `noExternal: [/.*/]` already covers it. Verify
  `npm run build` produces a working `scripts/gtd.js` that contains prettier.

## Acceptance criteria

- [ ] `prettier` listed under `dependencies` in `package.json`, removed from
      `devDependencies`.
- [ ] `npm install` succeeds.
- [ ] `npm run build` succeeds and `scripts/gtd.js` is regenerated.
- [ ] `npm run format:check` still works.

## Files

- `package.json` (edit)
