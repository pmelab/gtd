# Task: Add cosmiconfig dependency

Add `cosmiconfig` to `dependencies` in `package.json`. This task OWNS the
`package.json` edit for this package — no other task in package 01 may touch
`package.json` (file-disjoint rule).

## What to do

- [ ] Add `cosmiconfig` to the `dependencies` block of `package.json` (pin a
      recent stable major, e.g. `"cosmiconfig": "^9.0.0"`).
- [ ] Run `npm install` so the lockfile / `node_modules` reflect the new dep and
      the sibling `src/Config.ts` task can import it. Commit any lockfile change
      that results (this package's COMMIT_MSG covers it).
- [ ] Do NOT add `.js`/`.cjs` loaders anywhere; that decision is realized in
      `src/Config.ts` (sibling task). This task is purely the manifest + install.

## Constraints

- `yaml@^2.8.2` is already present (currently a devDependency) and is used by
  `src/Config.ts` for the YAML loader — do not remove or move it.
- Do NOT edit `tsup.config.ts` here; the existing `noExternal: [/.*/]` already
  inlines everything. Bundle verification happens in package 04 (the e2e
  package that rebuilds `scripts/gtd.js`).
- Touch ONLY `package.json` (and the lockfile produced by `npm install`). Do not
  edit `src/`.

## Acceptance criteria

- [ ] `cosmiconfig` appears under `dependencies` in `package.json`.
- [ ] `npm install` succeeds and `import { cosmiconfig }` resolves.
- [ ] `npm run test` (vitest) stays green.

## Files

- Edit: `package.json` (+ lockfile)
